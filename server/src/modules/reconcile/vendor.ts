/**
 * Vendor normalisation — pure.
 *
 * A bank narration names the same supplier a dozen ways: "ADOBE", "ADOBE
 * AUSTRALIA", "Adobe Australia Pty Ltd", "ADOBE CREATIVE CLOUD". Coding memory
 * keyed on the whole normalised description learns each of those separately
 * and recognises none of the others. The vendor key is the shortest token run
 * that still names the supplier, so one accepted transaction teaches a rule
 * that recognises the next narration from the same vendor.
 *
 * It is a heuristic and is treated as one: a learned key is a CONTAINS rule
 * that a person can see, edit and delete on the Coding Memory page, and the
 * engine re-validates it against the chart on every run like any other rule.
 */

/** Tokens that describe where or how a payment was made, never who was paid. */
const NOISE = new Set([
  "pty", "ltd", "limited", "inc", "llc", "plc", "co", "corp", "corporation", "company",
  "australia", "australian", "aus", "au", "nsw", "vic", "qld", "wa", "sa", "tas", "act", "nt",
  "online", "direct", "internet", "bpay", "payment", "payments", "pay", "bill", "billpay",
  "purchase", "debit", "credit", "deposit", "transfer", "eftpos", "visa", "mastercard",
  "the", "and", "of", "to", "at", "for", "from", "in", "on", "via",
  "pos", "tap", "paypal", "sq", "sp", "zip", "afterpay",
]);

/**
 * Words too generic to identify a supplier on their own. A key made of one
 * of these keeps its second token, so "property group" is learned rather
 * than "property".
 */
const GENERIC = new Set([
  "property", "group", "services", "service", "solutions", "systems", "holdings", "trading",
  "enterprises", "international", "national", "global", "digital", "media", "consulting",
  "management", "industries", "technologies", "technology", "partners", "associates",
  "store", "shop", "market", "supplies", "supply", "centre", "center", "city", "express",
  "general", "trust", "family", "business", "energy", "power", "water", "gas", "abc",
]);

/** Enough characters to be a name rather than a fragment. */
const MIN_KEY_LENGTH = 4;

/**
 * The vendor key of a normalised description, or null when nothing in the
 * narration names a supplier (a bare reference number, an empty string).
 *
 * Rules, in order: drop digits-only tokens and noise words; keep the first
 * token; keep the second as well when the first is generic or too short.
 */
export function vendorKey(normalised: string): string | null {
  const tokens = normalised
    .toLowerCase()
    .split(/[^a-z0-9&']+/)
    .filter((t) => t.length > 0 && !/^\d+$/.test(t) && !NOISE.has(t));
  if (tokens.length === 0) return null;

  const [first, second] = tokens;
  const needsSecond = second !== undefined && (GENERIC.has(first) || first.length < MIN_KEY_LENGTH);
  const key = needsSecond ? `${first} ${second}` : first;
  return key.length >= MIN_KEY_LENGTH ? key : null;
}
