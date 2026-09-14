import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { PROMPT_VERSION, buildContext, loadClassificationPrompt } from "./prompt";
import {
  ClassificationBatchSchema,
  sanitiseResult,
  type AccountingAIProvider,
  type ClassificationInput,
  type ClassificationResponse,
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
    const meta = {
      provider: this.name,
      model: this.model,
      promptVersion: PROMPT_VERSION,
    };

    try {
      const systemPrompt = loadClassificationPrompt();
      const context = buildContext(input);

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

      // A refusal or an unparseable body must never fall through to a default
      // coding — the whole batch goes to human review instead.
      const parsed = response.output_parsed;
      if (!parsed) {
        return {
          results: [],
          meta,
          failure: {
            kind: "invalid_output",
            detail: "Model returned no parseable structured output",
          },
        };
      }

      return {
        results: parsed.results.map(sanitiseResult),
        meta: {
          ...meta,
          inputTokens: response.usage?.input_tokens,
          outputTokens: response.usage?.output_tokens,
        },
      };
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      // Refusals surface as an error on this SDK path; classify them separately
      // so the review queue can show why.
      const kind = /refus/i.test(detail) ? "refusal" : "error";
      return { results: [], meta, failure: { kind, detail } };
    }
  }
}
