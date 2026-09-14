/**
 * The one piece of GST arithmetic, shared by the server and the journal form's
 * live preview so both sides show the same figure.
 *
 * Australian prices are quoted GST-inclusive, so the GST embedded in a gross
 * amount is `gross / 11` — NOT `gross × 0.10`. Rounds half away from zero,
 * matching ATO rounding, and preserves sign. Integer cents in, integer cents out.
 *
 * Whether a line bears GST at all is a tax-treatment decision made on the
 * server from the account and the client's registration; this function only
 * does the division once that decision is made.
 */
export function gstComponentCents(grossCents: number): number {
  const magnitude = Math.round(Math.abs(grossCents) / 11);
  return grossCents < 0 ? -magnitude : magnitude;
}
