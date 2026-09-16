import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import {
  PROMPT_VERSION,
  SUBCONTRACTOR_PROMPT_VERSION,
  buildContext,
  buildSubcontractorContext,
  hashInput,
  loadClassificationPrompt,
  loadSubcontractorPrompt,
} from "./prompt";
import {
  ClassificationBatchSchema,
  SubcontractorBatchSchema,
  sanitiseResult,
  sanitiseSubcontractor,
  type AccountingAIProvider,
  type ClassificationInput,
  type ClassificationResponse,
  type ProviderFailure,
  type ProviderMeta,
  type SubcontractorInput,
  type SubcontractorResponse,
} from "./types";

export class OpenAIProvider implements AccountingAIProvider {
  readonly name = "openai";
  readonly model: string;
  private client: OpenAI;

  constructor(apiKey: string, model: string) {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async classifyTransactions(input: ClassificationInput): Promise<ClassificationResponse> {
    const meta: ProviderMeta = { provider: this.name, model: this.model, promptVersion: PROMPT_VERSION };

    try {
      const systemPrompt = loadClassificationPrompt();
      const context = buildContext(input);
      meta.inputHash = hashInput(systemPrompt, context);

      // No `temperature: 0` here, though a classifier wants one.
      //
      // The current models on both providers have removed sampling parameters:
      // gpt-5.5 answers `400 Unsupported parameter: "temperature" is not
      // supported with this model`, and Claude Opus 5 returns a 400 the same way.
      // Pinning determinism that way is simply not available any more — it was
      // tried and measured, not assumed.
      //
      // So the same statement can code differently on a re-run. Two consequences
      // that are handled elsewhere rather than wished away: the golden set runs
      // several passes and reports the spread (scripts/ai-golden.ts), and every
      // coding stores its own lineage so a past decision stays explicable even
      // though it would not necessarily be reproduced.
      const response = await this.client.responses.parse({
        model: this.model,
        input: [
          { role: "system", content: systemPrompt },
          { role: "user", content: context },
        ],
        text: {
          format: zodTextFormat(ClassificationBatchSchema, "classification_batch"),
        },
      });

      meta.inputTokens = response.usage?.input_tokens;
      meta.outputTokens = response.usage?.output_tokens;

      const failure = failureOf(response);
      if (failure) return { results: [], meta, failure };

      return { results: response.output_parsed!.results.map(sanitiseResult), meta };
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      return { results: [], meta, failure: { kind: "error", detail } };
    }
  }

  async identifySubcontractors(input: SubcontractorInput): Promise<SubcontractorResponse> {
    const meta: ProviderMeta = { provider: this.name, model: this.model, promptVersion: SUBCONTRACTOR_PROMPT_VERSION };
    try {
      const systemPrompt = loadSubcontractorPrompt();
      const context = buildSubcontractorContext(input);
      meta.inputHash = hashInput(systemPrompt, context);

      const response = await this.client.responses.parse({
        model: this.model,
        input: [
          { role: "system", content: systemPrompt },
          { role: "user", content: context },
        ],
        text: { format: zodTextFormat(SubcontractorBatchSchema, "subcontractor_batch") },
      });

      meta.inputTokens = response.usage?.input_tokens;
      meta.outputTokens = response.usage?.output_tokens;

      const failure = failureOf(response);
      if (failure) return { results: [], meta, failure };

      return { results: response.output_parsed!.results.map(sanitiseSubcontractor), meta };
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      return { results: [], meta, failure: { kind: "error", detail } };
    }
  }
}

type ParsedResponse = { output: unknown; output_parsed: unknown };

/**
 * The Responses API surfaces a safety refusal as a content part of type
 * "refusal" on the message, not as an exception — so it is read from the
 * structured output, BEFORE `output_parsed` is trusted. No regex over an
 * error string: a refusal is a typed part or it is nothing.
 */
function refusalIn(output: unknown): string | null {
  if (!Array.isArray(output)) return null;
  for (const item of output) {
    const content = (item as { type?: string; content?: unknown })?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      const p = part as { type?: string; refusal?: string };
      if (p?.type === "refusal") return p.refusal || "Model declined the request";
    }
  }
  return null;
}

function failureOf(response: ParsedResponse): ProviderFailure | null {
  const refusal = refusalIn(response.output);
  if (refusal) return { kind: "refusal", detail: refusal };
  if (!response.output_parsed) {
    return { kind: "invalid_output", detail: "Model returned no parseable structured output" };
  }
  return null;
}
