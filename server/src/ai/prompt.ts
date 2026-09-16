import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ClassificationInput, SubcontractorInput } from "./types";

/**
 * The prompts and the request context, shared by every provider.
 *
 * Both live here rather than in each provider because `promptVersion` is
 * recorded as lineage on every classification: two providers that report the
 * same version must have sent the same prompt. A copy per provider makes that
 * claim quietly false the first time one of them is edited.
 */

export const PROMPT_VERSION = "transaction-classification-v2";
export const SUBCONTRACTOR_PROMPT_VERSION = "subcontractor-identification-v1";

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

const cache = new Map<string, string>();

function loadPrompt(file: string): string {
  let text = cache.get(file);
  if (text === undefined) {
    text = readFileSync(resolvePromptPath(file), "utf8");
    cache.set(file, text);
  }
  return text;
}

/** Reads the versioned classification prompt. Throws if it is missing. */
export function loadClassificationPrompt(): string {
  return loadPrompt(join("transaction-classification", "v2.md"));
}

/** Reads the versioned subcontractor-identification prompt. Throws if it is missing. */
export function loadSubcontractorPrompt(): string {
  return loadPrompt(join("subcontractor-identification", "v1.md"));
}

/* -------------------------------------------------------------------------- */
/* PII minimisation                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Australian bank narrations routinely carry things a classifier does not
 * need: card fragments ("CARD 4321", "xx1234"), BSB and account numbers,
 * PayID emails and phone numbers, the payer's full name. The merchant and the
 * nature of the supply are what decide a coding, so everything else is masked
 * before the text leaves the building. The masking is deterministic, so the
 * same narration always produces the same masked text and the same hash.
 */
export function maskDescription(description: string): string {
  return (
    description
      // Emails (PayID and the like) first, before digit rules eat their domains.
      .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/gi, "[email]")
      // 13–19 digit card numbers with optional separators.
      .replace(/\b(?:\d[ -]?){13,19}\b/g, "[card]")
      // Masked card fragments: "xx1234", "x-1234", "****1234", "card 1234", "ending 1234".
      .replace(/\b(?:x{2,}|\*{2,})[ -]?\d{3,4}\b/gi, "[card]")
      .replace(/\b(card|ending|acct|a\/c)[ #:-]*\d{4}\b/gi, "$1 [card]")
      // BSB-account pairs: 062-000 12345678, 062000 1234567.
      .replace(/\b\d{3}[ -]?\d{3}[ -]+\d{5,10}\b/g, "[bsb-account]")
      // Australian phone numbers: 04xx xxx xxx, (02) 9999 9999, +61 4 ...
      .replace(/(?:\+61[ -]?\d|\(0\d\)|\b0\d)[ -]?\d{4}[ -]?\d{4}\b/g, "[phone]")
      // Any remaining run of 8+ digits is an account, reference or receipt number.
      .replace(/\b\d{8,}\b/g, "[ref]")
      .replace(/\s{2,}/g, " ")
      .trim()
  );
}

/** SHA-256 of the exact text a provider was sent, for lineage. */
export function hashInput(...parts: string[]): string {
  return createHash("sha256").update(parts.join("\n---\n")).digest("hex");
}

/* -------------------------------------------------------------------------- */
/* Request context                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The part of the context that is constant for a client across every batch of
 * one import: who they are, the accounts they may be coded to, the firm's
 * prior decisions, and the accounts this client's people have used before.
 * Providers that support prefix caching put this first and cache it; the
 * rest send it inline.
 */
function stableLines(input: ClassificationInput): string[] {
  const candidates = input.candidateCodes?.length
    ? [
        `## Accounts this client has used before`,
        `Prefer these when they fit; the full chart above is still the universe, and Unknown is always allowed.`,
        input.candidateCodes.join(", "),
        ``,
      ]
    : [];
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
    ...candidates,
    input.memory.length
      ? `## Coding memory (prior decisions by this firm)\n` +
        input.memory
          .map((m) => `"${m.pattern}" -> ${m.accountCode} (${m.gstTreatment})`)
          .join("\n")
      : `## Coding memory\n(none yet)`,
    ``,
  ];
}

/** The batch itself — the only part that changes between requests. Descriptions are masked here. */
function transactionLines(input: ClassificationInput): string[] {
  return [
    `## Transactions to classify`,
    ...input.transactions.map((t) => {
      const line = `${t.ref} | ${t.date} | ${(t.amountCents / 100).toFixed(2)} | ${maskDescription(t.description)}`;
      const extras: string[] = [];
      // Appended only when the feed actually supplied them, so an uploaded
      // statement's line is byte-identical to what v1 produced.
      if (t.feedCategory || t.feedSubcategory) {
        extras.push(`category: ${[t.feedCategory, t.feedSubcategory].filter(Boolean).join("/")}`);
      }
      if (t.merchantCode) extras.push(`mcc: ${t.merchantCode}`);
      return extras.length ? `${line} | ${extras.join(" | ")}` : line;
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

/* -------------------------------------------------------------------------- */
/* Subcontractor identification context                                       */
/* -------------------------------------------------------------------------- */

export function buildSubcontractorContext(input: SubcontractorInput): string {
  return [
    `## Client`,
    `Industry: ${input.client.industry ?? "unknown"}`,
    ``,
    `## Subcontractor register (id | name | ABN)`,
    ...(input.known.length ? input.known.map((k) => `${k.id} | ${k.name} | ${k.abn ?? "no ABN"}`) : ["(empty)"]),
    ``,
    `## Payments to identify`,
    ...input.transactions.map((t) => `${t.ref} | ${t.date} | ${(t.amountCents / 100).toFixed(2)} | ${maskDescription(t.description)}`),
  ].join("\n");
}
