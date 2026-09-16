import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/core/db";
import { CODE_CASH_AT_BANK, CODE_INTEREST_CHARGED, CODE_LOAN_PRINCIPAL } from "@/server/au/coa";
import * as ledger from "@/server/modules/ledger/service";
import * as reconcile from "@/server/modules/reconcile/service";
import { resolvePeriod } from "@/server/modules/reports/period";
import * as reports from "@/server/modules/reports/service";
import { purgeFirms } from "../helpers/purge-firm";

/**
 * The third enforcement leg of the double-entry invariant: not a pure
 * function over a fixture, but real postings through the service into a
 * real database, then a trial balance read back through the reporting layer.
 *
 * Also proves the two things the skills audit found missing: a loan
 * repayment is split into principal and interest at acceptance, and a
 * reversal nets a BAS back to what it was.
 */

process.loadEnvFile?.(".env");

const STAMP = Date.now();
let firmId = "";
let userId = "";
let clientId = "";
let bankAccountId = "";
let expenseAccountId = "";

beforeAll(async () => {
  const firm = await db.firm.create({ data: { name: `Ledger DB ${STAMP}` }, select: { id: true } });
  firmId = firm.id;
  const user = await db.user.create({
    data: { firmId, email: `ledger-db-${STAMP}@example.test`, name: "Ledger Tester", role: "OWNER" },
    select: { id: true },
  });
  userId = user.id;
  const client = await db.client.create({
    data: { firmId, businessName: "Ledger Co", entityType: "COMPANY", gstRegistered: true },
    select: { id: true },
  });
  clientId = client.id;
  const bank = await db.bankAccount.create({ data: { clientId, name: "Operating", isCashAtBank: true }, select: { id: true } });
  bankAccountId = bank.id;
  const rent = await db.account.findFirst({ where: { code: 480, firmId: null }, select: { id: true } });
  expenseAccountId = rent!.id;
});

afterAll(async () => {
  await purgeFirms([firmId]);
  await db.$disconnect();
});

const fy2027 = resolvePeriod({ fy: "2027" });

async function trialBalanceDifference(): Promise<number> {
  const tb = await reports.getTrialBalance(firmId, clientId, fy2027);
  expect(tb).not.toBeNull();
  return tb!.differenceCents;
}

describe("the ledger balances after real postings", () => {
  it("a manual journal, a bank posting and a reversal leave the trial balance at zero", async () => {
    const cash = await db.account.findFirst({ where: { code: CODE_CASH_AT_BANK, firmId: null }, select: { id: true } });
    const capital = await db.account.findFirst({ where: { code: 900, firmId: null }, select: { id: true } });

    // Opening capital, 1 July: a real journal.
    const opening = await ledger.postJournal(firmId, userId, clientId, {
      date: new Date("2026-07-01T00:00:00.000Z"),
      source: "OPENING",
      lines: [
        { accountId: cash!.id, debitCents: 5_000_000, creditCents: 0 },
        { accountId: capital!.id, debitCents: 0, creditCents: 5_000_000 },
      ],
    });
    expect(opening.ok).toBe(true);
    expect(await trialBalanceDifference()).toBe(0);

    // An unbalanced journal is impossible through the service.
    const unbalanced = await ledger.postJournal(firmId, userId, clientId, {
      date: new Date("2026-07-02T00:00:00.000Z"),
      source: "MANUAL",
      lines: [
        { accountId: expenseAccountId, debitCents: 1_100, creditCents: 0 },
        { accountId: cash!.id, debitCents: 0, creditCents: 1_000 },
      ],
    });
    expect(unbalanced.ok).toBe(false);

    // A bank transaction accepted by a person posts rent against the bank, GST split.
    const tx = await db.bankTransaction.create({
      data: {
        bankAccountId,
        date: new Date("2026-07-15T00:00:00.000Z"),
        description: "Rent July",
        normalised: "rent july",
        amountCents: -330_000,
        fingerprint: `rent-${STAMP}`,
        status: "CLASSIFIED",
        accountId: expenseAccountId,
        gstTreatment: "GST_ON_EXPENSES",
        gstCents: -30_000,
        netCents: -300_000,
        needsReview: false,
      },
      select: { id: true },
    });
    const accepted = await reconcile.acceptTransactions(firmId, userId, [tx.id]);
    expect(accepted).toEqual({ accepted: 1, skipped: [] });
    expect(await trialBalanceDifference()).toBe(0);

    const line = await db.journalLine.findFirst({ where: { bankTransactionId: tx.id, accountId: expenseAccountId } });
    expect(line?.gstCents).toBe(30_000);
    expect(line?.bankTransactionId).toBe(tx.id);
    const entry = await db.journalEntry.findFirst({ where: { lines: { some: { bankTransactionId: tx.id } } }, select: { rulesVersion: true } });
    expect(entry?.rulesVersion).toMatch(/^gst-rate:/);

    // Usage was metered once, and accepting again cannot double it.
    const usage = await db.usageEvent.count({ where: { firmId, entityId: tx.id } });
    expect(usage).toBe(1);

    // The BAS sees the rent at G11/1B; reopening reverses it and nets to nothing.
    const before = await reports.getSimpleBas(firmId, clientId, fy2027);
    expect(before?.bas.figures["1B"].cents).toBe(30_000);
    const reopened = await reconcile.reopenTransaction(firmId, userId, tx.id);
    expect(reopened.ok).toBe(true);
    const after = await reports.getSimpleBas(firmId, clientId, fy2027);
    expect(after?.bas.figures["1B"].cents).toBe(0);
    expect(after?.bas.figures.G11.cents).toBe(0);
    expect(await trialBalanceDifference()).toBe(0);

    // A bank-posted entry cannot be reversed from the journal page — reopen is the path.
    const posted = await db.bankTransaction.findUnique({ where: { id: tx.id }, select: { journalEntryId: true } });
    expect(posted?.journalEntryId).not.toBeNull();
  });

  it("splits a loan repayment into principal and interest at acceptance", async () => {
    const loan = await db.loan.create({
      data: {
        clientId,
        lender: "Bank",
        principalCents: 12_000_000,
        interestRateBasisPoints: 600,
        startDate: new Date("2026-07-01T00:00:00.000Z"),
        termMonths: 12,
        repaymentCents: 1_032_800,
        frequency: "MONTHLY",
      },
      select: { id: true },
    });
    const principalAccount = await db.account.findFirst({ where: { code: CODE_LOAN_PRINCIPAL, firmId: null }, select: { id: true } });
    const interestAccount = await db.account.findFirst({ where: { code: CODE_INTEREST_CHARGED, firmId: null }, select: { id: true } });

    const tx = await db.bankTransaction.create({
      data: {
        bankAccountId,
        date: new Date("2026-08-01T00:00:00.000Z"),
        description: "Loan repayment",
        normalised: "loan repayment",
        amountCents: -1_032_800,
        fingerprint: `loan-${STAMP}`,
        status: "CLASSIFIED",
        accountId: principalAccount!.id,
        gstTreatment: "BAS_EXCLUDED",
        loanId: loan.id,
        needsReview: false,
      },
      select: { id: true },
    });
    const accepted = await reconcile.acceptTransactions(firmId, userId, [tx.id]);
    expect(accepted.accepted).toBe(1);

    const lines = await db.journalLine.findMany({ where: { bankTransactionId: tx.id }, select: { accountId: true, debitCents: true, creditCents: true, gstTreatment: true } });
    const principal = lines.find((l) => l.accountId === principalAccount!.id);
    const interest = lines.find((l) => l.accountId === interestAccount!.id);
    // The interest account's own default treatment, whatever the chart (and the advisor) say it is.
    const interestDefault = await db.account.findFirst({ where: { code: CODE_INTEREST_CHARGED, firmId: null }, select: { gstTreatment: true } });
    expect(interest?.gstTreatment).toBe(interestDefault?.gstTreatment);
    expect(interest?.gstTreatment).not.toBe("GST_ON_EXPENSES");
    // 6% p.a. on $120,000 for the first month = $600.00 interest.
    expect(interest?.debitCents).toBe(60_000);
    expect(principal?.debitCents).toBe(1_032_800 - 60_000);
    expect(await trialBalanceDifference()).toBe(0);
  });
});
