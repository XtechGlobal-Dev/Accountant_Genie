import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
  PROMPT_VERSION,
  buildStableContext,
  buildTransactionContext,
  loadClassificationPrompt,
} from "./prompt";
import {
  ClassificationBatchSchema,
  sanitiseResult,
  type AccountingAIProvider,
  type ClassificationInput,
  type ClassificationResponse,
} from "./types";

/**
 * Room for adaptive thinking plus one full batch of results. Thinking tokens
 * count against this ceiling on Claude Opus 5, where thinking is on by
 * default, so a budget sized only for the answer truncates the batch and
 * sends every transaction in it to review.
 */
const MAX_TOKENS = 32_000;

/**
 * Classification through the Anthropic Messages API.
 *
 * Two properties matter more than accuracy here and are enforced below rather
 * than hoped for: a refusal or an unparseable body never produces a coding, and
 * the model is never asked to compute a GST figure — it chooses a tax code and
 * deterministic code does the arithmetic.
 *
 * `effort` is deliberately left at its default (`high`). Bulk classification is
 * the one place where trading quality for tokens is tempting and wrong: a
 * transaction sent to review costs fifteen seconds, a confident miscoding costs
 * a wrong BAS.
 */
export class AnthropicProvider implements AccountingAIProvider {
  readonly name = "anthropic";
  readonly model: string;
  private client: Anthropic;

  constructor(apiKey: string, model: string) {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  /**
   * Note for anyone matching this to the OpenAI provider: do NOT add
   * `temperature: 0` here.
   *
   * Sampling parameters were removed on the current Claude models -
   * `temperature`, `top_p` and `top_k` return a 400 on Opus 5, Opus 4.8/4.7
   * and Sonnet 5. Adding one to pin determinism would take the whole AI tier
   * offline rather than steady it. Depth is controlled by `output_config.effort`.
   */
  async classifyTransactions(input: ClassificationInput): Promise<ClassificationResponse> {
    const meta = {
      provider: this.name,
      model: this.model,
      promptVersion: PROMPT_VERSION,
    };

    try {
      // Read inside the try: a missing or unreadable prompt routes the batch to
      // review like any other provider failure, rather than killing the job.
      const systemPrompt = loadClassificationPrompt();

      // Everything stable for this client — the prompt, the chart of accounts
      // and the coding memory — goes in `system` with the cache breakpoint
      // after it, so the batches of one import reuse the same prefix. The
      // transactions are the only part that varies, so they go last.
      const response = await this.client.messages
        .stream({
          model: this.model,
          max_tokens: MAX_TOKENS,
          system: [
            { type: "text", text: systemPrompt },
            {
              type: "text",
              text: buildStableContext(input),
              cache_control: { type: "ephemeral" },
            },
          ],
          messages: [{ role: "user", content: buildTransactionContext(input) }],
          output_config: {
            format: zodOutputFormat(ClassificationBatchSchema),
          },
        })
        .finalMessage();

      const usage = {
        // The response reports which model actually served it. Recording that
        // rather than the requested id keeps lineage truthful — a report must
        // name the model that produced the coding, not the one we asked for.
        model: response.model ?? this.model,
        inputTokens: response.usage?.input_tokens,
        outputTokens: response.usage?.output_tokens,
        cacheReadTokens: response.usage?.cache_read_input_tokens ?? undefined,
        cacheWriteTokens: response.usage?.cache_creation_input_tokens ?? undefined,
      };

      // A safety decline arrives as HTTP 200 with stop_reason "refusal", so it
      // has to be checked before the content is read. It routes the whole batch
      // to human review — never to a default coding.
      if (response.stop_reason === "refusal") {
        return {
          results: [],
          meta: { ...meta, ...usage },
          failure: {
            kind: "refusal",
            detail: response.stop_details?.explanation ?? "Model declined the request",
          },
        };
      }

      const parsed = response.parsed_output;
      if (!parsed) {
        return {
          results: [],
          meta: { ...meta, ...usage },
          failure: {
            kind: "invalid_output",
            detail: describeEmptyOutput(response.stop_reason),
          },
        };
      }

      return {
        results: parsed.results.map(sanitiseResult),
        meta: { ...meta, ...usage },
      };
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      return { results: [], meta, failure: { kind: "error", detail } };
    }
  }
}

/**
 * The reason reaches an accountant in the review queue, so it has to say what
 * to do about it. "No parseable output" for a batch that was simply too large
 * leaves an operator with no signal to lower RECONCILE_BATCH_SIZE.
 */
function describeEmptyOutput(stopReason: string | null): string {
  switch (stopReason) {
    case "max_tokens":
      return `Model hit the ${MAX_TOKENS.toLocaleString()} token output limit before completing the batch — lower RECONCILE_BATCH_SIZE`;
    case "model_context_window_exceeded":
      return "Request exceeded the model's context window — lower RECONCILE_BATCH_SIZE or trim the chart of accounts";
    default:
      return "Model returned no parseable structured output";
  }
}
