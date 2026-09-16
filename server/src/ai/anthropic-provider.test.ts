import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClassificationInput } from "./types";

/**
 * The AI tier's failure paths, which are the part a regression breaks silently.
 *
 * CLAUDE.md §6: "Always check `stop_reason === 'refusal'` before reading
 * content; always handle null `parsed_output`. Both route to human review."
 * A provider that returned a coding on either path would still typecheck and
 * still pass every other test in this suite, so both are asserted here.
 */

const finalMessage = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { stream: () => ({ finalMessage }) };
  },
}));

vi.mock("@anthropic-ai/sdk/helpers/zod", () => ({
  zodOutputFormat: () => ({ type: "json_schema" }),
}));

const { AnthropicProvider } = await import("./anthropic-provider");

const input: ClassificationInput = {
  transactions: [
    { ref: "t1", description: "bunnings alexandria", amountCents: -12100, date: "2026-07-01" },
    { ref: "t2", description: "acct keeping fee", amountCents: -1500, date: "2026-07-02" },
  ],
  client: { industry: "construction", entityType: "COMPANY", gstRegistered: true },
  accounts: [{ code: 310, name: "Materials", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES" }],
  memory: [],
};

const usage = { input_tokens: 900, output_tokens: 120, cache_read_input_tokens: 4000, cache_creation_input_tokens: 0 };

function provider() {
  return new AnthropicProvider("test-key", "claude-opus-5");
}

beforeEach(() => {
  finalMessage.mockReset();
});

describe("AnthropicProvider", () => {
  it("maps a good batch through sanitiseResult and records cache lineage", async () => {
    finalMessage.mockResolvedValue({
      stop_reason: "end_turn",
      usage,
      parsed_output: {
        results: [
          { ref: "t1", accountCode: 310, gstTreatment: "GST_ON_EXPENSES", confidence: 0.91, reason: "hardware", needsReview: false },
          // Out-of-range confidence and an Unknown code must both be forced to review.
          { ref: "t2", accountCode: 0, gstTreatment: "UNALLOCATED", confidence: 1.4, reason: "unclear", needsReview: false },
        ],
      },
    });

    const out = await provider().classifyTransactions(input);

    expect(out.failure).toBeUndefined();
    expect(out.results[0]).toMatchObject({ ref: "t1", accountCode: 310, confidence: 0.91, needsReview: false });
    expect(out.results[1]).toMatchObject({ ref: "t2", accountCode: 0, confidence: 1, needsReview: true });
    expect(out.meta).toMatchObject({
      provider: "anthropic",
      model: "claude-opus-5",
      promptVersion: "transaction-classification-v3",
      inputTokens: 900,
      outputTokens: 120,
      cacheReadTokens: 4000,
    });
  });

  it("routes a refusal to review without reading content", async () => {
    finalMessage.mockResolvedValue({
      stop_reason: "refusal",
      stop_details: { type: "refusal", category: "cyber", explanation: "declined" },
      usage,
      // A provider that read content before checking stop_reason would code these.
      parsed_output: {
        results: [
          { ref: "t1", accountCode: 310, gstTreatment: "GST_ON_EXPENSES", confidence: 1, reason: "x", needsReview: false },
        ],
      },
    });

    const out = await provider().classifyTransactions(input);

    expect(out.results).toEqual([]);
    expect(out.failure).toMatchObject({ kind: "refusal", detail: "declined" });
  });

  it("routes a null parsed_output to review", async () => {
    finalMessage.mockResolvedValue({ stop_reason: "end_turn", usage, parsed_output: null });

    const out = await provider().classifyTransactions(input);

    expect(out.results).toEqual([]);
    expect(out.failure?.kind).toBe("invalid_output");
  });

  it("tells the reviewer which limit was hit", async () => {
    finalMessage.mockResolvedValue({ stop_reason: "max_tokens", usage, parsed_output: null });
    const truncated = await provider().classifyTransactions(input);
    expect(truncated.failure?.detail).toMatch(/RECONCILE_BATCH_SIZE/);

    finalMessage.mockResolvedValue({ stop_reason: "model_context_window_exceeded", usage, parsed_output: null });
    const overflowed = await provider().classifyTransactions(input);
    expect(overflowed.failure?.detail).toMatch(/context window/);
  });

  it("routes a thrown transport error to review rather than propagating it", async () => {
    finalMessage.mockRejectedValue(new Error("connection reset"));

    const out = await provider().classifyTransactions(input);

    expect(out.results).toEqual([]);
    expect(out.failure).toMatchObject({ kind: "error", detail: "connection reset" });
  });
});
