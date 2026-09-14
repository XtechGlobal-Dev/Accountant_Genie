/**
 * Money at the edges.
 *
 * The domain holds integer cents. These helpers are the only place a person's
 * typed amount ("1,234.50") becomes cents, and they do it with string
 * arithmetic — never `parseFloat`, which would turn 0.29 into 28.999999 cents.
 */

/**
 * Parse a typed dollar amount into integer cents.
 *
 * Accepts "1234.5", "1,234.50", "$12", "-3.10", "(3.10)". Rejects more than two
 * decimal places rather than rounding: a third decimal is a typo in a ledger,
 * not a request to round. Returns `null` when the input is not an amount.
 */
export function parseCents(input: string): number | null {
  let s = input.trim().replace(/[$,\s]/g, "");
  if (s === "") return null;

  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }

  const match = /^(\d*)(?:\.(\d{0,2}))?$/.exec(s);
  if (!match) return null;
  const whole = match[1] ?? "";
  const frac = match[2] ?? "";
  if (whole === "" && frac === "") return null;

  const cents = Number(whole || "0") * 100 + Number(frac.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

/**
 * Parse a typed percentage ("33.33", "50", "12.5%") into basis points, where
 * 10 000 is 100%. Same string arithmetic as `parseCents`, same refusal to
 * round a third decimal. Returns `null` when the input is not a percentage.
 */
export function parseBasisPoints(input: string): number | null {
  const cents = parseCents(input.replace(/%/g, ""));
  if (cents === null || cents < 0) return null;
  return cents;
}

/** "33.33" — what an input should display for stored basis points. */
export function basisPointsToInput(basisPoints: number): string {
  return centsToInput(basisPoints);
}

/** "33.33%" for display. */
export function formatBasisPoints(basisPoints: number): string {
  return `${centsToInput(basisPoints)}%`;
}

/** "1234.50" — what an input should display for a stored amount. */
export function centsToInput(cents: number): string {
  const negative = cents < 0;
  const magnitude = Math.abs(cents);
  const whole = Math.trunc(magnitude / 100);
  const frac = (magnitude % 100).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${frac}`;
}
