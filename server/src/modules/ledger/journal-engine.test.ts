import { describe, expect, it } from "vitest";
import { buildBankJournal, type BankJournalLine } from "./journal-engine";
import { checkJournalShape } from "./validate";

/**
 * The five postings in the brief, plus the ways a posting can be wrong. The
 * ledger stores GROSS with the GST snapshotted on the line; the assertions
 * here say so in cents, and then prove the same lines pass the shape check
 * the manual posting path applies.
 */

const BANK = "acc-bank";
const posting = (amountCents: number, accountId: string, gstTreatment: BankJournalLine["gstTreatment"], gstRegistered = true) =>
  buildBankJournal({
    amountCents,
    gstRegistered,
    bankLedgerAccountId: BANK,
    allocations: [{ accountId, cents: Math.abs(amountCents), gstTreatment }],
    bankTransactionId: "tx-1",
  });

function totals(lines: readonly BankJournalLine[]) {
  return lines.reduce((t, l) => ({ debit: t.debit + l.debitCents, credit: t.credit + l.creditCents }), { debit: 0, credit: 0 });
}

describe("buildBankJournal — GST-inclusive expense", () => {
  it("posts $1,100 gross to the expense with $100 GST on the line, against $1,100 from the bank", () => {
    const result = posting(-110_000, "acc-subscriptions", "GST_ON_EXPENSES");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines).toEqual([
      { accountId: "acc-subscriptions", description: null, debitCents: 110_000, creditCents: 0, gstCents: 10_000, gstTreatment: "GST_ON_EXPENSES", subcontractorId: null, bankTransactionId: "tx-1" },
      { accountId: BANK, description: null, debitCents: 0, creditCents: 110_000, gstCents: 0, gstTreatment: "BAS_EXCLUDED", subcontractorId: null, bankTransactionId: "tx-1" },
    ]);
    expect(result.gstCents).toBe(10_000);
    expect(result.totalCents).toBe(110_000);
    // Net $1,000 is what the P&L reads: gross − gst.
    expect(result.lines[0]!.debitCents - result.lines[0]!.gstCents).toBe(100_000);
  });

  it("uses gross / 11, never gross × 10%: $550 carries $50, $330 carries $30", () => {
    const office = posting(-55_000, "acc-office", "GST_ON_EXPENSES");
    const power = posting(-33_000, "acc-power", "GST_ON_EXPENSES");
    expect(office.ok && office.gstCents).toBe(5_000);
    expect(power.ok && power.gstCents).toBe(3_000);
  });

  it("carries no GST for a client that is not registered", () => {
    const result = posting(-110_000, "acc-subscriptions", "GST_ON_EXPENSES", false);
    expect(result.ok && result.gstCents).toBe(0);
  });
});

describe("buildBankJournal — GST-free and BAS-excluded", () => {
  it("posts a GST-free $2,000 rent with no GST", () => {
    const result = posting(-200_000, "acc-rent", "GST_FREE_EXPENSES");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines[0]).toMatchObject({ debitCents: 200_000, gstCents: 0, gstTreatment: "GST_FREE_EXPENSES" });
    expect(result.lines[1]).toMatchObject({ accountId: BANK, creditCents: 200_000 });
  });

  it("posts BAS-excluded $2,500 wages with no GST", () => {
    const result = posting(-250_000, "acc-wages", "BAS_EXCLUDED");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines[0]).toMatchObject({ debitCents: 250_000, gstCents: 0, gstTreatment: "BAS_EXCLUDED" });
    expect(result.gstCents).toBe(0);
  });
});

describe("buildBankJournal — direction", () => {
  it("credits income and debits the bank for money in, with GST on the income line", () => {
    const result = posting(880_000, "acc-sales", "GST_ON_INCOME");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines[0]).toMatchObject({ accountId: "acc-sales", debitCents: 0, creditCents: 880_000, gstCents: 80_000 });
    expect(result.lines[1]).toMatchObject({ accountId: BANK, debitCents: 880_000, creditCents: 0 });
  });

  it("records negative GST on a refund credited to an expense account", () => {
    const result = posting(11_000, "acc-office", "GST_ON_EXPENSES");
    expect(result.ok && result.lines[0]!.gstCents).toBe(-1_000);
  });
});

describe("buildBankJournal — balance", () => {
  const brief = [
    posting(-55_000, "acc-office", "GST_ON_EXPENSES"),
    posting(-110_000, "acc-subscriptions", "GST_ON_EXPENSES"),
    posting(-200_000, "acc-rent", "GST_FREE_EXPENSES"),
    posting(-33_000, "acc-power", "GST_ON_EXPENSES"),
    posting(-250_000, "acc-wages", "BAS_EXCLUDED"),
  ];

  it("balances every journal, and the five from the brief pass the shape check", () => {
    for (const result of brief) {
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      const t = totals(result.lines);
      expect(t.debit).toBe(t.credit);
      expect(checkJournalShape(result.lines)).toBeNull();
    }
  });

  it("adds up to the brief's totals: $6,480 gross, $180 GST, $6,300 net", () => {
    const ok = brief.filter((r) => r.ok);
    const gross = ok.reduce((s, r) => s + (r.ok ? r.totalCents : 0), 0);
    const gst = ok.reduce((s, r) => s + (r.ok ? r.gstCents : 0), 0);
    expect(gross).toBe(648_000);
    expect(gst).toBe(18_000);
    expect(gross - gst).toBe(630_000);
  });

  it("splits a loan repayment into two lines that still balance", () => {
    const result = buildBankJournal({
      amountCents: -106_619,
      gstRegistered: true,
      bankLedgerAccountId: BANK,
      allocations: [
        { accountId: "acc-loan", cents: 90_000, gstTreatment: "BAS_EXCLUDED", description: "Principal" },
        { accountId: "acc-interest", cents: 16_619, gstTreatment: "GST_FREE_EXPENSES", description: "Interest" },
      ],
      bankTransactionId: "tx-2",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines).toHaveLength(3);
    const t = totals(result.lines);
    expect(t.debit).toBe(106_619);
    expect(t.credit).toBe(106_619);
  });
});

describe("buildBankJournal — rejection", () => {
  const base = { amountCents: -110_000, gstRegistered: true, bankLedgerAccountId: BANK, bankTransactionId: "tx-1" };

  it("refuses an unbalanced posting: allocations that do not sum to the amount", () => {
    const result = buildBankJournal({ ...base, allocations: [{ accountId: "acc-x", cents: 100_000, gstTreatment: "GST_ON_EXPENSES" }] });
    expect(result).toEqual({ ok: false, error: "Allocations (100000) do not sum to the transaction amount (110000)" });
  });

  it("refuses a zero amount, no allocations, and fractional cents", () => {
    expect(buildBankJournal({ ...base, amountCents: 0, allocations: [{ accountId: "acc-x", cents: 0, gstTreatment: "GST_ON_EXPENSES" }] }).ok).toBe(false);
    expect(buildBankJournal({ ...base, allocations: [] }).ok).toBe(false);
    expect(buildBankJournal({ ...base, allocations: [{ accountId: "acc-x", cents: 110_000.5, gstTreatment: "GST_ON_EXPENSES" }] }).ok).toBe(false);
  });

  it("refuses an undecided tax treatment and a posting back to the bank account itself", () => {
    expect(buildBankJournal({ ...base, allocations: [{ accountId: "acc-x", cents: 110_000, gstTreatment: "UNALLOCATED" }] })).toMatchObject({ ok: false, error: "The tax treatment is not yet decided" });
    expect(buildBankJournal({ ...base, allocations: [{ accountId: BANK, cents: 110_000, gstTreatment: "BAS_EXCLUDED" }] }).ok).toBe(false);
  });
});
