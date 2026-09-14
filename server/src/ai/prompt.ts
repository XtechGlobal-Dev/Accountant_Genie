import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ClassificationInput } from "./types";

/**
 * The prompt and the request context, shared by every provider.
 *
 * Both live here rather than in each provider because `promptVersion` is
 * recorded as lineage on every classification: two providers that report the
 * same version must have sent the same prompt. A copy per provider makes that
 * claim quietly false the first time one of them is edited.
 */

export const PROMPT_VERSION = "transaction-classification-v2";

/**
 * Prompts live on disk and are versioned — never inline in business logic.
 *
 * Backend entry points disagree about their working directory: the worker,
 * the seed, the scripts and the tests run with `server/` as cwd, while the
 * Next process runs from the repository root (which is why `next.config.ts`
 * loads `server/.env` rather than `.env`). Resolving one cwd-relative path
 * therefore works in exactly one of them — and the failure is an ENOENT at
 * the moment an accountant uploads a statement.
 */
function resolvePromptPath(file: string): string {
  const candidates = [
    join(process.cwd(), "prompts", file), //        cwd = server/
    join(process.cwd(), "server", "prompts", file), // cwd = repository root
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      `Prompt "${file}" not found. Looked in:\n  ${candidates.join("\n  ")}`,
    );
  }
  return found;
}

let cachedPrompt: string | null = null;

/** Reads the versioned classification prompt. Throws if it is missing. */
export function loadClassificationPrompt(): string {
  if (cachedPrompt === null) {
    cachedPrompt = readFileSync(
      resolvePromptPath(join("transaction-classification", "v2.md")),
      "utf8",
    );
  }
  return cachedPrompt;
}

/* -------------------------------------------------------------------------- */
/* Request context                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The part of the context that is constant for a client across every batch of
 * one import: who they are, the accounts they may be coded to, and the firm's
 * prior decisions. Providers that support prefix caching put this first and
 * cache it; the rest send it inline.
 */
function stableLines(input: ClassificationInput): string[] {
  return [
    `## Client`,
    `Industry: ${input.client.industry ?? "unknown"}`,
    `Entity: ${input.client.entityType}`,
    `GST registered: ${input.client.gstRegistered ? "yes" : "no"}`,
    ``,
    `## Chart of accounts`,
    ...input.accounts.map(
      (a) =>
        `${a.code} | ${a.name} | ${a.type} | ${a.gstTreatment}${a.description ? ` | ${a.description}` : ""}`,
    ),
    ``,
    input.memory.length
      ? `## Coding memory (prior decisions by this firm)\n` +
        input.memory
          .map((m) => `"${m.pattern}" -> ${m.accountCode} (${m.gstTreatment})`)
          .join("\n")
      : `## Coding memory\n(none yet)`,
    ``,
  ];
}

/** The batch itself — the only part that changes between requests. */
function transactionLines(input: ClassificationInput): string[] {
  return [
    `## Transactions to classify`,
    ...input.transactions.map((t) => {
      const line = `${t.ref} | ${t.date} | ${(t.amountCents / 100).toFixed(2)} | ${t.description}`;
      // Appended only when the feed actually supplied one, so an uploaded
      // statement's line is byte-identical to what v1 produced.
      if (!t.feedCategory && !t.feedSubcategory) return line;
      const category = [t.feedCategory, t.feedSubcategory].filter(Boolean).join("/");
      return `${line} | category: ${category}`;
    }),
  ];
}

export function buildStableContext(input: ClassificationInput): string {
  return stableLines(input).join("\n");
}

export function buildTransactionContext(input: ClassificationInput): string {
  return transactionLines(input).join("\n");
}

/** The whole context as one block, for providers without a caching split. */
export function buildContext(input: ClassificationInput): string {
  return [...stableLines(input), ...transactionLines(input)].join("\n");
}
