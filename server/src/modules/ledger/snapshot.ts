import type { GstTreatment, JournalSource } from "@/shared/enums";
import { gstFromGross, naturalGross } from "@/server/au/gst";

/**
 * The GST snapshot a journal line carries, decided once for every path that
 * posts: the manual form, the reconciliation engine, the demo seed.
 *
 * GST is a deterministic function of the account's treatment and the
 * client's registration — never taken from input. Two cases carry none:
 *
 *   - An unregistered client claims nothing and charges nothing, so every
 *     line is whole.
 *   - An OPENING balance is the position brought forward, not an acquisition
 *     or a supply in the period. A ute bought last year sits on the asset
 *     account at cost, and the GST on it was claimed on last year's BAS. Left
 *     to the account's treatment, a capital-treatment asset would push its
 *     whole opening balance into G10 and a tenth of it into 1B — a credit
 *     claimed twice. So an opening line is BAS-excluded whatever its account
 *     says, and reaches no label.
 *
 * No I/O, so the rule is unit-tested and the seed can call it without the
 * server-only boundary.
 */
export interface GstSnapshot {
  readonly gstCents: number;
  readonly gstTreatment: GstTreatment;
}

export function snapshotGst(input: {
  readonly source: JournalSource;
  readonly accountTreatment: GstTreatment;
  readonly debitCents: number;
  readonly creditCents: number;
  readonly gstRegistered: boolean;
}): GstSnapshot {
  if (input.source === "OPENING") {
    return { gstCents: 0, gstTreatment: "BAS_EXCLUDED" };
  }
  const gross = naturalGross(input.accountTreatment, input.debitCents, input.creditCents);
  return {
    gstCents: input.gstRegistered ? gstFromGross(gross, input.accountTreatment) : 0,
    gstTreatment: input.accountTreatment,
  };
}
