/**
 * Display formatting. Money is integer cents everywhere in the domain; it
 * becomes a string only here, at the view boundary.
 */

const AUD = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  minimumFractionDigits: 2,
});

const PLAIN = new Intl.NumberFormat("en-AU", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function money(cents: number): string {
  return AUD.format(cents / 100);
}

/** No currency symbol — for dense table columns where the header carries it. */
export function amount(cents: number): string {
  return PLAIN.format(cents / 100);
}

/** Accounting convention: negatives in parentheses. */
export function accounting(cents: number): string {
  const s = PLAIN.format(Math.abs(cents) / 100);
  return cents < 0 ? `(${s})` : s;
}

export function shortDate(d: Date): string {
  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}

/** Australian ABN display grouping: 51 824 753 556 */
export function abn(value: string | null): string {
  if (!value) return "—";
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 11) return value;
  return `${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}`;
}
