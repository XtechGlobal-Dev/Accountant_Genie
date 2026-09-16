import { describe, expect, it } from "vitest";
import { buildContext, buildStableContext, buildTransactionContext, loadClassificationPrompt } from "./prompt";
import type { ClassificationInput } from "./types";

const input: ClassificationInput = {
  transactions: [
    { ref: "t1", description: "bunnings alexandria", amountCents: -12100, date: "2026-07-01" },
  ],
  client: { industry: null, entityType: "COMPANY", gstRegistered: true },
  accounts: [
    { code: 310, name: "Materials", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES", description: "Job materials" },
    { code: 404, name: "Bank Fees", type: "EXPENSE", gstTreatment: "INPUT_TAXED" },
  ],
  memory: [{ pattern: "bunnings", accountCode: 310, gstTreatment: "GST_ON_EXPENSES" }],
};

describe("loadClassificationPrompt", () => {
  it("finds the prompt regardless of which entry point set the cwd", () => {
    // The worker and the tests run from server/; the Next process runs from the
    // repository root. Resolving one cwd-relative path works in only one of them.
    const prompt = loadClassificationPrompt();
    expect(prompt).toContain("transaction-classification v3");
    expect(prompt).toContain("Abstention is correct");
  });
});

describe("context", () => {
  it("splits into a stable prefix and the batch, and the two rejoin unchanged", () => {
    // The split exists so the prefix can be cached; it must not change what the
    // model sees, or two providers reporting the same promptVersion would differ.
    expect(buildContext(input)).toBe(`${buildStableContext(input)}\n${buildTransactionContext(input)}`);
  });

  it("keeps the client, chart and memory out of the per-batch half", () => {
    const batch = buildTransactionContext(input);
    expect(batch).toContain("t1 | 2026-07-01 | -121.00 | bunnings alexandria");
    expect(batch).not.toContain("Chart of accounts");
    expect(batch).not.toContain("Coding memory");
  });

  it("carries account descriptions when present and omits the separator when not", () => {
    const stable = buildStableContext(input);
    expect(stable).toContain("310 | Materials | EXPENSE | GST_ON_EXPENSES | Job materials");
    expect(stable).toContain("404 | Bank Fees | EXPENSE | INPUT_TAXED\n");
  });

  it("says so explicitly when there is no memory yet", () => {
    expect(buildStableContext({ ...input, memory: [] })).toContain("## Coding memory\n(none yet)");
  });

  it("appends the bank feed category when the feed supplied one", () => {
    const batch = buildTransactionContext({
      ...input,
      transactions: [
        {
          ref: "t1",
          description: "bunnings alexandria",
          amountCents: -12100,
          date: "2026-07-01",
          feedCategory: "HOME",
          feedSubcategory: "HARDWARE",
        },
      ],
    });
    expect(batch).toContain("t1 | 2026-07-01 | -121.00 | bunnings alexandria | category: HOME/HARDWARE");
  });

  it("renders a lone subcategory without a stray separator", () => {
    const batch = buildTransactionContext({
      ...input,
      transactions: [
        {
          ref: "t1",
          description: "shell coles express",
          amountCents: -8900,
          date: "2026-07-02",
          feedCategory: null,
          feedSubcategory: "FUEL",
        },
      ],
    });
    expect(batch).toContain("| category: FUEL");
    expect(batch).not.toContain("category: /FUEL");
  });

  it("leaves an uploaded statement's line byte-identical to v1", () => {
    // Statement rows carry no feed category. If their line changed shape, every
    // upload would silently start hitting a different prompt than it used to.
    const batch = buildTransactionContext({
      ...input,
      transactions: [
        {
          ref: "t1",
          description: "bunnings alexandria",
          amountCents: -12100,
          date: "2026-07-01",
          feedCategory: null,
          feedSubcategory: null,
        },
      ],
    });
    expect(batch).toContain("t1 | 2026-07-01 | -121.00 | bunnings alexandria");
    expect(batch).not.toContain("category:");
  });

  it("documents the category as weak evidence that never outranks memory", () => {
    // These guardrails are the whole reason it is safe to put a CONSUMER
    // taxonomy in front of an accounting decision. If the wording is ever
    // dropped, the prompt version must change with it.
    const prompt = loadClassificationPrompt();
    expect(prompt).toContain("## Bank feed category");
    expect(prompt).toContain("It never outranks coding memory");
    expect(prompt).toContain("It is not evidence about GST");
  });
});
