/**
 * The Australian Business Number.
 *
 * Eleven digits with a modulus-89 checksum, which is the difference between
 * "eleven digits" and "an ABN". A digit-count check accepts 11111111111 and
 * every single-digit typo, and those get as far as a report before anyone
 * notices.
 *
 * That matters most for **subcontractors**: their ABN is reported on the TPAR,
 * which goes to the ATO, and quoting a wrong one is not a cosmetic error. It
 * also decides whether no-ABN withholding applies to a payment at all.
 *
 * The algorithm is the ATO's published one:
 *   1. Subtract 1 from the FIRST digit only.
 *   2. Multiply each of the eleven digits by its positional weight.
 *   3. The ABN is valid when the sum is divisible by 89.
 *
 * This is arithmetic on a published standard, not a tax rule that changes, so
 * it needs no versioning and no advisor sign-off — unlike anything in
 * `tax-rules`. See CLAUDE.md §6.
 */

const WEIGHTS = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19] as const;

/** Digits only. Accepts the spaced form people copy from ABN Lookup. */
export function normaliseAbn(input: string): string {
  return input.replace(/[\s-]/g, "");
}

export function isValidAbn(input: string): boolean {
  const digits = normaliseAbn(input);
  if (!/^\d{11}$/.test(digits)) return false;

  let sum = 0;
  for (let i = 0; i < 11; i++) {
    // Only the first digit is decremented.
    const digit = Number(digits[i]) - (i === 0 ? 1 : 0);
    // A leading zero would go negative here, and an ABN never starts with 0.
    if (digit < 0) return false;
    sum += digit * WEIGHTS[i]!;
  }
  return sum % 89 === 0;
}

/** "51 824 753 556" — the grouping the ATO prints and people recognise. */
export function formatAbn(input: string): string {
  const digits = normaliseAbn(input);
  if (digits.length !== 11) return input;
  return `${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5, 8)} ${digits.slice(8, 11)}`;
}
