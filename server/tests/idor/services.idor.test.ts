import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/core/db";
import * as accounts from "@/server/modules/accounts/service";
import * as assets from "@/server/modules/assets/service";
import * as banking from "@/server/modules/banking/service";
import * as feeds from "@/server/modules/banking/feeds";
import * as auth from "@/server/modules/auth/service";
import * as clients from "@/server/modules/clients/service";
import * as ledger from "@/server/modules/ledger/service";
import * as loans from "@/server/modules/loans/service";
import * as reconcile from "@/server/modules/reconcile/service";
import { resolvePeriod } from "@/server/modules/reports/period";
import * as reports from "@/server/modules/reports/service";
import * as subcontractors from "@/server/modules/subcontractors/service";
import { listJobs, findOwnedJob } from "@/server/jobs/service";

/**
 * Tenant isolation, proven rather than assumed.
 *
 * Two firms are created with the same shape of data. Every read and write
 * service is then called as Firm A against Firm B's ids and must answer
 * "not found" — never data, never "forbidden". A route without an entry here
 * is not finished.
 */

process.loadEnvFile?.(".env");

interface Fixture {
  firmId: string;
  userId: string;
  clientId: string;
  bankAccountId: string;
  transactionId: string;
  entryId: string;
  accountId: string;
  memoryRuleId: string;
  assetId: string;
  loanId: string;
  subcontractorId: string;
  feedRequestId: string;
  jobId: string;
  trustedDeviceId: string;
}

const STAMP = Date.now();

async function seedFirm(tag: string): Promise<Fixture> {
  const firm = await db.firm.create({ data: { name: `IDOR ${tag} ${STAMP}` }, select: { id: true } });
  const user = await db.user.create({
    data: { firmId: firm.id, email: `idor-${tag}-${STAMP}@example.test`, name: `User ${tag}`, role: "OWNER" },
    select: { id: true },
  });
  const client = await db.client.create({
    data: { firmId: firm.id, businessName: `Client ${tag}`, entityType: "COMPANY" },
    select: { id: true },
  });
  const bank = await db.bankAccount.create({
    data: { clientId: client.id, name: "Bank", isCashAtBank: true },
    select: { id: true },
  });
  const tx = await db.bankTransaction.create({
    data: {
      bankAccountId: bank.id,
      date: new Date("2026-07-02T00:00:00.000Z"),
      description: `Purchase ${tag}`,
      normalised: `purchase ${tag}`,
      amountCents: -1100,
      fingerprint: `fp-${tag}-${STAMP}`,
    },
    select: { id: true },
  });
  const account = await db.account.create({
    data: { firmId: firm.id, code: 1500 + (tag === "A" ? 0 : 1), name: `Custom ${tag}`, type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES" },
    select: { id: true },
  });
  const cash = await db.account.findFirst({ where: { code: 701, firmId: null }, select: { id: true } });
  const entry = await db.journalEntry.create({
    data: {
      clientId: client.id,
      date: new Date("2026-07-05T00:00:00.000Z"),
      source: "MANUAL",
      totalCents: 1100,
      lines: {
        create: [
          { accountId: account.id, debitCents: 1100, creditCents: 0, gstCents: 100, gstTreatment: "GST_ON_EXPENSES" },
          { accountId: cash!.id, debitCents: 0, creditCents: 1100, gstCents: 0, gstTreatment: "BAS_EXCLUDED" },
        ],
      },
    },
    select: { id: true },
  });
  const rule = await db.memoryRule.create({
    data: { firmId: firm.id, clientId: client.id, pattern: `merchant ${tag}`, accountId: account.id, gstTreatment: "GST_ON_EXPENSES" },
    select: { id: true },
  });
  const asset = await db.asset.create({
    data: { clientId: client.id, name: "Ute", costCents: 100_000, purchaseDate: new Date("2026-07-01T00:00:00.000Z"), effectiveLifeMonths: 96 },
    select: { id: true },
  });
  const loan = await db.loan.create({
    data: { clientId: client.id, lender: "Bank", principalCents: 100_000, interestRateBasisPoints: 700, startDate: new Date("2026-07-01T00:00:00.000Z"), termMonths: 12, repaymentCents: 9_000 },
    select: { id: true },
  });
  const sub = await db.subcontractor.create({ data: { clientId: client.id, name: `Sub ${tag}` }, select: { id: true } });
  const feed = await db.bankFeedRequest.create({
    data: { clientId: client.id, email: "c@example.test", tokenHash: `hash-${tag}-${STAMP}`, expiresAt: new Date(Date.now() + 86_400_000) },
    select: { id: true },
  });
  const job = await db.job.create({
    data: { firmId: firm.id, clientId: client.id, type: "RECONCILE_CLIENT", idempotencyKey: `idor-${tag}-${STAMP}` },
    select: { id: true },
  });
  const device = await db.trustedDevice.create({
    data: {
      userId: user.id,
      tokenHash: `device-${tag}-${STAMP}`,
      label: "Chrome on Windows",
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
    },
    select: { id: true },
  });
  return {
    firmId: firm.id,
    userId: user.id,
    clientId: client.id,
    bankAccountId: bank.id,
    transactionId: tx.id,
    entryId: entry.id,
    accountId: account.id,
    memoryRuleId: rule.id,
    assetId: asset.id,
    loanId: loan.id,
    subcontractorId: sub.id,
    feedRequestId: feed.id,
    jobId: job.id,
    trustedDeviceId: device.id,
  };
}

let a: Fixture;
let b: Fixture;

beforeAll(async () => {
  a = await seedFirm("A");
  b = await seedFirm("B");
});

afterAll(async () => {
  const firmIds = [a.firmId, b.firmId];

  // JournalLine.account is onDelete: Restrict on purpose — a deleted account must
  // not be able to rewrite an already-prepared BAS. So the ledger has to come out
  // from the leaves inward before the firms themselves can go.
  const where = { client: { firmId: { in: firmIds } } };
  await db.journalLine.deleteMany({ where: { entry: where } });
  await db.journalEntry.deleteMany({ where });
  await db.firm.deleteMany({ where: { id: { in: firmIds } } });
  await db.$disconnect();
});

const period = resolvePeriod({ fy: "2027" });
const notFound = { ok: false, error: expect.stringMatching(/not found/i) };

describe("Firm A cannot read Firm B", () => {
  it("clients", async () => {
    expect(await clients.getClientHeader(a.firmId, b.clientId)).toBeNull();
    expect(await clients.getClientDetail(a.firmId, b.clientId)).toBeNull();
    expect(await clients.getClientOverview(a.firmId, b.clientId)).toBeNull();
    expect(await clients.getPartners(a.firmId, b.clientId)).toBeNull();
    expect(await clients.getTrustDetails(a.firmId, b.clientId)).toBeNull();
    expect(await clients.getClientNotes(a.firmId, b.clientId)).toBeNull();
    expect(await clients.getClientLogo(a.firmId, b.clientId)).toBeNull();
    expect(await clients.hasClientLedgerData(a.firmId, b.clientId)).toBeNull();
    expect((await clients.listClients(a.firmId, false)).map((c) => c.id)).not.toContain(b.clientId);
  });

  it("bank accounts, feeds and transactions", async () => {
    expect(await banking.listAccounts(a.firmId, b.clientId)).toBeNull();
    expect(await feeds.listFeedRequests(a.firmId, b.clientId)).toBeNull();
    expect(await reconcile.listTransactions(a.firmId, b.clientId)).toBeNull();
    expect(await reconcile.getReviewSummary(a.firmId, b.clientId)).toBeNull();
    expect(await reconcile.listMemory(a.firmId, b.clientId)).toBeNull();
    expect((await reconcile.listMemory(a.firmId))?.map((r) => r.id)).not.toContain(b.memoryRuleId);
  });

  // A trusted device removes the second factor from a sign-in, so one firm
  // reaching another's is the worst version of this bug: it would let a
  // stranger strip someone's MFA, or learn which browsers they work from.
  it("trusted devices", async () => {
    expect(await auth.listDevices(a.firmId, b.userId)).toEqual([]);
    expect((await auth.listDevices(a.firmId, a.userId)).map((d) => d.id)).not.toContain(b.trustedDeviceId);
  });

  it("ledger and reports", async () => {
    expect(await ledger.listJournals(a.firmId, b.clientId)).toBeNull();
    expect(await ledger.getJournal(a.firmId, b.clientId, b.entryId)).toBeNull();
    expect(await ledger.getJournal(a.firmId, a.clientId, b.entryId)).toBeNull();
    expect(await reports.getProfitAndLoss(a.firmId, b.clientId, period)).toBeNull();
    expect(await reports.getBalanceSheet(a.firmId, b.clientId, period)).toBeNull();
    expect(await reports.getSimpleBas(a.firmId, b.clientId, period)).toBeNull();
    expect(await reports.getTpar(a.firmId, b.clientId, 2027)).toBeNull();
    expect(await reports.getEofyStatement(a.firmId, b.clientId, 2027)).toBeNull();
    expect(await reports.getJournalExport(a.firmId, b.clientId, period, "xero")).toBeNull();
  });

  it("chart of accounts", async () => {
    const chart = await accounts.getChartOfAccounts(a.firmId);
    expect(chart.groups.flatMap((g) => g.rows).map((r) => r.id)).not.toContain(b.accountId);
    expect(await accounts.listAccountOptions(a.firmId, b.clientId)).toBeNull();
  });

  it("registers and jobs", async () => {
    expect(await assets.listAssets(a.firmId, b.clientId)).toBeNull();
    expect(await loans.listLoans(a.firmId, b.clientId)).toBeNull();
    expect(await loans.getLoan(a.firmId, b.clientId, b.loanId)).toBeNull();
    expect(await subcontractors.listSubcontractors(a.firmId, b.clientId)).toBeNull();
    expect(await findOwnedJob(a.firmId, b.jobId)).toBeNull();
    expect((await listJobs(a.firmId)).map((j) => j.id)).not.toContain(b.jobId);
  });
});

describe("Firm A cannot write to Firm B", () => {
  it("clients and partners", async () => {
    expect(await clients.setClientArchived(a.firmId, b.clientId, true)).toBe(false);
    expect(await clients.addClientNote(a.firmId, b.clientId, { title: "x", body: "y" })).toBe(false);
    expect(await clients.removeClientLogo(a.firmId, b.clientId)).toBe(false);
    expect(await clients.setClientLogo(a.firmId, b.clientId, new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0]))).toMatchObject(notFound);
    expect(await clients.savePartners(a.firmId, a.userId, b.clientId, { partners: [{ name: "P", shareBasisPoints: 10_000 }] })).toMatchObject(notFound);
    expect(
      await clients.saveTrustDetails(a.firmId, a.userId, b.clientId, {
        trustee: { kind: "CORPORATE", name: "T Pty Ltd", abn: "", signatories: [] },
        beneficiaries: [{ name: "B", kind: "INDIVIDUAL" }],
      }),
    ).toMatchObject(notFound);
  });

  it("bank accounts and feeds", async () => {
    expect(await banking.updateAccount(a.firmId, b.bankAccountId, { name: "x", kind: "BANK", accountMask: "", isCashAtBank: false })).toBeNull();
    expect(await banking.createAccount(a.firmId, b.clientId, { name: "x", kind: "BANK", accountMask: "", isCashAtBank: false })).toBeNull();
    expect(await feeds.cancelFeedRequest(a.firmId, a.userId, b.feedRequestId)).toMatchObject(notFound);
  });

  it("transactions and memory", async () => {
    expect(await reconcile.recodeTransaction(a.firmId, a.userId, b.transactionId, { accountId: a.accountId, remember: "NONE", matchType: "EXACT" })).toMatchObject(notFound);
    expect((await reconcile.acceptTransactions(a.firmId, a.userId, [b.transactionId])).skipped[0]?.reason).toBe("Not found");
    expect(await reconcile.reopenTransaction(a.firmId, a.userId, b.transactionId)).toMatchObject(notFound);
    expect(await reconcile.excludeTransaction(a.firmId, a.userId, b.transactionId, { reason: "x" })).toMatchObject(notFound);
    expect(await reconcile.updateMemoryRule(a.firmId, a.userId, b.memoryRuleId, { pattern: "zz", matchType: "EXACT", accountId: a.accountId, gstTreatment: "GST_ON_EXPENSES" })).toMatchObject(notFound);
    expect(await reconcile.deleteMemoryRule(a.firmId, a.userId, b.memoryRuleId)).toMatchObject(notFound);
    expect(await reconcile.runReconciliation(a.firmId, a.userId, b.clientId)).toBeNull();
  });

  it("ledger — including a foreign account on an own client", async () => {
    const date = new Date("2026-07-10T00:00:00.000Z");
    const lines = [
      { accountId: b.accountId, debitCents: 100, creditCents: 0 },
      { accountId: a.accountId, debitCents: 0, creditCents: 100 },
    ];
    expect(await ledger.postJournal(a.firmId, a.userId, b.clientId, { date, source: "MANUAL", lines })).toMatchObject(notFound);
    // Firm B's private account cannot be posted to from Firm A's own client either.
    expect(await ledger.postJournal(a.firmId, a.userId, a.clientId, { date, source: "MANUAL", lines })).toMatchObject({ ok: false, error: expect.stringMatching(/account not found/i) });
    expect(await ledger.reverseJournal(a.firmId, a.userId, b.clientId, b.entryId, { date })).toMatchObject(notFound);
  });

  it("trusted devices, by any combination of firm and user", async () => {
    expect(await auth.revokeDevice(a.firmId, a.userId, b.trustedDeviceId)).toMatchObject(notFound);
    // Naming Firm B's user does not help: the firm is still Firm A's session.
    expect(await auth.revokeDevice(a.firmId, b.userId, b.trustedDeviceId)).toMatchObject(notFound);
    // Nor does naming Firm B's firm with Firm A's user.
    expect(await auth.revokeDevice(b.firmId, a.userId, b.trustedDeviceId)).toMatchObject(notFound);
    const still = await db.trustedDevice.findUnique({
      where: { id: b.trustedDeviceId },
      select: { revokedAt: true },
    });
    expect(still?.revokedAt).toBeNull();
  });

  it("chart of accounts", async () => {
    const input = { name: "x", code: 1900, type: "EXPENSE" as const, gstTreatment: "GST_ON_EXPENSES" as const, clientId: b.clientId };
    expect(await accounts.createCustomAccount(a.firmId, a.userId, input)).toMatchObject({ ok: false, field: "clientId" });
    expect(await accounts.updateCustomAccount(a.firmId, a.userId, b.accountId, { ...input, clientId: "" })).toMatchObject(notFound);
    expect(await accounts.setCustomAccountActive(a.firmId, a.userId, b.accountId, false)).toMatchObject(notFound);
  });

  it("registers", async () => {
    const assetInput = { name: "x", category: "OTHER" as const, totalCostCents: null, gstCents: null, costCents: 100, purchaseDate: new Date(), method: "PRIME_COST" as const, effectiveLifeMonths: 12, privateUseBasisPoints: 0, isCar: false };
    expect(await assets.createAsset(a.firmId, a.userId, b.clientId, assetInput)).toMatchObject(notFound);
    expect(await assets.updateAsset(a.firmId, a.userId, b.assetId, assetInput)).toMatchObject(notFound);
    expect(await assets.disposeAsset(a.firmId, a.userId, b.assetId, { disposedAt: new Date(), disposalCents: 0 })).toMatchObject(notFound);
    const loanInput = { type: "BANK_LOAN" as const, lender: "x", principalCents: 100, interestRateBasisPoints: 100, startDate: new Date(), termMonths: 12, repaymentCents: 10, frequency: "MONTHLY" as const };
    expect(await loans.createLoan(a.firmId, a.userId, b.clientId, loanInput)).toMatchObject(notFound);
    expect(await loans.updateLoan(a.firmId, a.userId, b.loanId, loanInput)).toMatchObject(notFound);
    expect(await loans.setLoanStatus(a.firmId, a.userId, b.loanId, "CLOSED")).toMatchObject(notFound);
    expect(await subcontractors.createSubcontractor(a.firmId, a.userId, b.clientId, { name: "x" })).toMatchObject(notFound);
    expect(await subcontractors.updateSubcontractor(a.firmId, a.userId, b.subcontractorId, { name: "x" })).toMatchObject(notFound);
    expect(await subcontractors.setSubcontractorActive(a.firmId, a.userId, b.subcontractorId, false)).toMatchObject(notFound);
  });
});
