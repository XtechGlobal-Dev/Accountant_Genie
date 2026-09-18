import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/core/db";
import { MockProvider, setAIProvider } from "@/server/ai";
import * as accountsRepo from "@/server/modules/accounts/repository";
import * as ingest from "@/server/modules/ingest/service";
import * as reconcile from "@/server/modules/reconcile/service";
import { resolvePeriod } from "@/server/modules/reports/period";
import * as reports from "@/server/modules/reports/service";
import type { ImportOutcome, ReconcileStats } from "@/shared/contracts/transaction";
import { purgeFirms } from "../helpers/purge-firm";

/**
 * The whole pipeline, end to end, against a real database:
 *
 *   bank statement → normalise → dedup → memory / rules / AI → account
 *   resolution → GST → journal dry run → Ready or Review → accept → post →
 *   trial balance, P&L and BAS → learn → the next import resolves from memory
 *
 * The five transactions are the ones in the brief. The deterministic
 * MockProvider stands in for the model — as classifier and as reviewer —
 * so the numbers are exact and the run costs nothing.
 */

try {
  process.loadEnvFile(".env");
} catch {
  // Absent in CI — the environment provides DATABASE_URL.
}

const STAMP = Date.now();
let firmId = "";
let otherFirmId = "";
let userId = "";
let clientId = "";
let bankAccountId = "";

const BRIEF = [
  "Date,Description,Amount,Balance",
  "02/09/2026,OFFICEWORKS AUBURN PRINTER PAPER AND STATIONERY,-550.00,9450.00",
  "05/09/2026,ADOBE AUSTRALIA CREATIVE CLOUD SUBSCRIPTION,-1100.00,8350.00",
  "12/09/2026,PROPERTY GROUP PTY LTD MONTHLY OFFICE RENT,-2000.00,6350.00",
  "15/09/2026,ENERGYAUSTRALIA OFFICE ELECTRICITY,-330.00,6020.00",
  "24/09/2026,ABC PAYROLL EMPLOYEE WAGES,-2500.00,3520.00",
].join("\n");


/**
 * Import a file the way the app does — upload, then the job — and wait for
 * the job to finish. The outcome, stats included, is read back through the
 * same call the upload dialog makes, so this proves the numbers a person
 * sees, not just the rows in the table.
 */
async function importCsv(csv: string, filename: string): Promise<ImportOutcome & { reconcile: ReconcileStats }> {
  const started = await ingest.importStatement(firmId, userId, { bankAccountId, filename, size: csv.length }, Buffer.from(csv));
  expect(started.ok).toBe(true);
  if (!started.ok) throw new Error(started.error);
  const deadline = Date.now() + 90_000;
  for (;;) {
    const outcome = await ingest.getImportOutcome(firmId, started.importId);
    if (outcome?.status === "FAILED") throw new Error(`Import failed: ${outcome.error}`);
    // The import row turns COMPLETE a moment before the job writes its
    // COMPLETED event, which is what carries the stats — wait for those.
    if (outcome?.status === "COMPLETE" && outcome.reconcile) {
      return { ...outcome, reconcile: outcome.reconcile };
    }
    if (Date.now() > deadline) throw new Error(`Import ${started.importId} did not finish in time`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function rows() {
  return db.bankTransaction.findMany({
    where: { bankAccountId },
    orderBy: { date: "asc" },
    select: {
      id: true,
      description: true,
      amountCents: true,
      status: true,
      source: true,
      needsReview: true,
      risk: true,
      reasoning: true,
      gstTreatment: true,
      gstCents: true,
      netCents: true,
      journalEntryId: true,
      memoryRuleId: true,
      version: true,
      account: { select: { code: true, name: true } },
    },
  });
}

beforeAll(async () => {
  setAIProvider(new MockProvider());
  const firm = await db.firm.create({ data: { name: `Pipeline DB ${STAMP}` }, select: { id: true } });
  firmId = firm.id;
  const other = await db.firm.create({ data: { name: `Pipeline Other ${STAMP}` }, select: { id: true } });
  otherFirmId = other.id;
  const user = await db.user.create({
    data: { firmId, email: `pipeline-db-${STAMP}@example.test`, name: "Pipeline Tester", role: "OWNER" },
    select: { id: true },
  });
  userId = user.id;
  const client = await db.client.create({
    data: { firmId, businessName: "Brief Co", entityType: "COMPANY", gstRegistered: true, industry: "Professional services" },
    select: { id: true },
  });
  clientId = client.id;
  const bank = await db.bankAccount.create({ data: { clientId, name: "Business Bank", isCashAtBank: true }, select: { id: true } });
  bankAccountId = bank.id;
});

afterAll(async () => {
  await purgeFirms([firmId, otherFirmId]);
  await db.$disconnect();
});

const fy2027 = resolvePeriod({ fy: "2027" });

describe("bank transaction → account → tax → journal → ledger", () => {
  it("imports the five transactions: four Ready to accept, one needing a look, none Unknown", async () => {
    const outcome = await importCsv(BRIEF, "september.csv");
    expect(outcome.insertedCount).toBe(5);
    expect(outcome.duplicateCount).toBe(0);

    const stats = outcome.reconcile;
    expect(stats.processed).toBe(5);
    expect(stats.unknown).toBe(0);
    expect(stats.byRule).toBe(1); // wages: the rules tier, no AI call
    expect(stats.byAi).toBe(4);
    expect(stats.autoCoded).toBe(4);
    expect(stats.needsReview).toBe(1);
    expect(stats.accountsCreated).toEqual([]);
    expect(stats.reviewReasons).toEqual([{ reason: "Rent — confirm whether the landlord charges GST before accepting", count: 1 }]);
    // The reviewer saw the four AI codings: agreed with three the classifier
    // was already sure of (so nothing to clear) and escalated the rent, as
    // the classifier had. The rules-tier wages row is the firm's own policy
    // and is never reviewed.
    expect(stats.reviewer).toEqual({ checked: 4, agreed: 3, disagreed: 0, escalated: 1, cleared: 0, failure: null });

    const coded = await rows();
    const byDesc = (needle: string) => coded.find((r) => r.description.includes(needle))!;
    expect(byDesc("OFFICEWORKS")).toMatchObject({ account: { code: 450 }, gstTreatment: "GST_ON_EXPENSES", gstCents: -5_000, netCents: -50_000, needsReview: false, risk: "LOW" });
    expect(byDesc("ADOBE")).toMatchObject({ account: { code: 470 }, gstTreatment: "GST_ON_EXPENSES", gstCents: -10_000, netCents: -100_000, needsReview: false });
    expect(byDesc("ENERGYAUSTRALIA")).toMatchObject({ account: { code: 360 }, gstTreatment: "GST_ON_EXPENSES", gstCents: -3_000, netCents: -30_000, needsReview: false });
    expect(byDesc("PAYROLL")).toMatchObject({ account: { code: 600 }, source: "RULE", gstTreatment: "BAS_EXCLUDED", gstCents: 0, needsReview: false });
    // Rent: the account is known, the treatment is a person's call.
    expect(byDesc("RENT")).toMatchObject({ account: { code: 480 }, needsReview: true });
    expect(byDesc("RENT").reasoning).toContain("AI reviewer: Rent — confirm whether the landlord charges GST");
    expect(byDesc("ADOBE").reasoning).toContain("AI reviewer agreed (0.97)");
  });

  it("posts balanced journals on acceptance, and the reports read them back as the brief expects", async () => {
    const coded = await rows();
    const rent = coded.find((r) => r.description.includes("RENT"))!;
    const rentAccount = await db.account.findFirst({ where: { code: 480, firmId: null }, select: { id: true } });

    // The accountant's decision on the one row that needed a look: this
    // landlord does not charge GST. Deterministic code recomputes the GST.
    const recoded = await reconcile.recodeTransaction(firmId, userId, rent.id, {
      accountId: rentAccount!.id,
      gstTreatment: "GST_FREE_EXPENSES",
      remember: "NONE",
      matchType: "EXACT",
      version: rent.version,
    });
    expect(recoded.ok).toBe(true);

    const accepted = await reconcile.acceptTransactions(firmId, userId, coded.map((r) => r.id));
    expect(accepted.skipped).toEqual([]);
    expect(accepted.accepted).toBe(5);

    const posted = await rows();
    expect(posted.every((r) => r.status === "REVIEWED" && r.journalEntryId !== null)).toBe(true);

    // Every journal balances, and every entry holds exactly one transaction's lines.
    const entries = await db.journalEntry.findMany({ where: { clientId }, select: { id: true, totalCents: true, lines: { select: { debitCents: true, creditCents: true, gstCents: true } } } });
    expect(entries).toHaveLength(5);
    for (const entry of entries) {
      const debit = entry.lines.reduce((s, l) => s + l.debitCents, 0);
      const credit = entry.lines.reduce((s, l) => s + l.creditCents, 0);
      expect(debit).toBe(credit);
      expect(entry.totalCents).toBe(debit);
    }
    expect(entries.reduce((s, e) => s + e.totalCents, 0)).toBe(648_000); // total debits = total credits = $6,480

    const tb = await reports.getTrialBalance(firmId, clientId, fy2027);
    expect(tb?.differenceCents).toBe(0);
    expect(tb?.totalDebitCents).toBe(tb?.totalCreditCents);

    const pl = await reports.getProfitAndLoss(firmId, clientId, fy2027);
    expect(pl?.totalExpensesCents).toBe(630_000); // net of GST: $6,300
    expect(pl?.netProfitCents).toBe(-630_000);

    const bas = await reports.getSimpleBas(firmId, clientId, fy2027);
    expect(bas?.bas.unresolvedCount).toBe(0);
    expect(bas?.bas.figures["1B"].cents).toBe(18_000); // GST on purchases: $180
    expect(bas?.bas.figures["1A"].cents).toBe(0);
    // Every figure names the bank rows it came from.
    expect(bas?.bas.figures["1B"].contributors).toHaveLength(3);
  });

  it("never posts a journal twice: accepting again is skipped, and re-importing the file inserts nothing", async () => {
    const before = await db.journalEntry.count({ where: { clientId } });
    const again = await reconcile.acceptTransactions(firmId, userId, (await rows()).map((r) => r.id));
    expect(again.accepted).toBe(0);
    expect(again.skipped.every((s) => s.reason === "Already accepted")).toBe(true);

    const outcome = await importCsv(BRIEF, "september-again.csv");
    expect(outcome.insertedCount).toBe(0);
    expect(outcome.duplicateCount).toBe(5);
    expect(await db.journalEntry.count({ where: { clientId } })).toBe(before);
    expect(await db.bankTransaction.count({ where: { bankAccountId } })).toBe(5);
  });

  it("learns the vendor from acceptance, so the next narration from the same supplier resolves from memory before any AI call", async () => {
    const rules = await db.memoryRule.findMany({ where: { firmId, clientId }, select: { pattern: true, matchType: true, account: { select: { code: true } } }, orderBy: { pattern: "asc" } });
    // The three AI-coded accepts taught a rule each; the rule-tier wages row and
    // the hand-recoded rent (remember: NONE) taught nothing.
    expect(rules).toEqual([
      { pattern: "adobe", matchType: "CONTAINS", account: { code: 470 } },
      { pattern: "energyaustralia", matchType: "CONTAINS", account: { code: 360 } },
      { pattern: "officeworks", matchType: "CONTAINS", account: { code: 450 } },
    ]);

    const next = [
      "Date,Description,Amount,Balance",
      "05/10/2026,ADOBE AUSTRALIA PTY LTD,-1100.00,2420.00",
      "07/10/2026,VISA PURCHASE OFFICEWORKS 0142 AUBURN CARD 4523,-96.50,2323.50",
    ].join("\n");
    const outcome = await importCsv(next, "october.csv");
    const stats = outcome.reconcile;
    expect(stats.processed).toBe(2);
    expect(stats.byMemory).toBe(2);
    expect(stats.byAi).toBe(0);
    expect(stats.autoCoded).toBe(2);
    expect(stats.tokens.calls).toBe(0);

    const adobe = (await rows()).find((r) => r.description === "ADOBE AUSTRALIA PTY LTD")!;
    expect(adobe).toMatchObject({ source: "MEMORY", account: { code: 470 }, needsReview: false, gstCents: -10_000 });
    expect(adobe.memoryRuleId).not.toBeNull();
  });

  it("does not overwrite a memory rule that points elsewhere when a different coding is accepted", async () => {
    const rule = await db.memoryRule.findFirst({ where: { firmId, clientId, pattern: "adobe" }, select: { id: true, accountId: true, evidenceCount: true } });
    const adobe = (await rows()).find((r) => r.description === "ADOBE AUSTRALIA PTY LTD")!;
    const software = await db.account.findFirst({ where: { code: 340, firmId: null }, select: { id: true } });

    // A person moves this one to 340 Computer Equipment and Software without remembering.
    const recoded = await reconcile.recodeTransaction(firmId, userId, adobe.id, { accountId: software!.id, remember: "NONE", matchType: "EXACT", version: adobe.version });
    expect(recoded.ok).toBe(true);
    const accepted = await reconcile.acceptTransactions(firmId, userId, [adobe.id]);
    expect(accepted.accepted).toBe(1);

    const after = await db.memoryRule.findFirst({ where: { id: rule!.id }, select: { accountId: true, evidenceCount: true } });
    expect(after).toEqual({ accountId: rule!.accountId, evidenceCount: rule!.evidenceCount });
  });
});

describe("account proposal → validation → creation", () => {
  it("creates one firm-wide account for a supply the chart lacks, and the rows are Ready once the AI reviewer confirms the proposal", async () => {
    const csv = [
      "Date,Description,Amount,Balance",
      "10/10/2026,CHARITY DONATION RED CROSS,-200.00,2000.00",
      "11/10/2026,DONATION SALVATION ARMY,-50.00,1950.00",
    ].join("\n");
    const outcome = await importCsv(csv, "donations.csv");
    const stats = outcome.reconcile;
    expect(stats.processed).toBe(2);
    expect(stats.unknown).toBe(0);
    expect(stats.accountsCreated).toEqual([{ code: 1400, name: "Donations" }]);
    // Without the reviewer both rows would wait for a person to confirm the
    // new account. The reviewer judged the proposal itself — the nature of
    // the supply, the type, the treatment — and agreed, so both are Ready.
    expect(stats.needsReview).toBe(0);
    expect(stats.autoCoded).toBe(2);
    expect(stats.reviewReasons).toEqual([]);
    expect(stats.reviewer).toEqual({ checked: 2, agreed: 2, disagreed: 0, escalated: 0, cleared: 2, failure: null });

    const created = await db.account.findMany({ where: { firmId, name: "Donations" }, select: { code: true, clientId: true, type: true, gstTreatment: true, requiresVerification: true, isSystem: true } });
    expect(created).toEqual([{ code: 1400, clientId: null, type: "EXPENSE", gstTreatment: "BAS_EXCLUDED", requiresVerification: true, isSystem: false }]);

    const audit = await db.auditLog.findFirst({ where: { firmId, action: "ACCOUNT_CREATED" }, select: { after: true } });
    expect(audit?.after).toMatchObject({ code: 1400, name: "Donations", source: "AI_PROPOSAL", provider: "mock" });

    const donations = (await rows()).filter((r) => r.description.includes("DONATION"));
    expect(donations).toHaveLength(2);
    for (const row of donations) {
      expect(row.account?.code).toBe(1400);
      expect(row.needsReview).toBe(false);
      expect(row.gstTreatment).toBe("BAS_EXCLUDED");
      expect(row.reasoning).toContain("AI reviewer agreed (0.97)");
    }
    // The verdict is lineage on the row, next to the classifier's proposal.
    const lineage = await db.bankTransaction.findFirst({ where: { id: donations[0]!.id }, select: { aiMeta: true } });
    expect(lineage?.aiMeta).toMatchObject({
      tier: "ai",
      accountCreated: true,
      reviewer: { provider: "mock", promptVersion: "mock-review-v1", verdict: "AGREE", cleared: true },
    });
  });

  it("creates nothing the second time: the resolver finds the account it made", async () => {
    const csv = ["Date,Description,Amount,Balance", "12/10/2026,DONATION TO CHARITY SMITH FAMILY FOUNDATION,-75.00,1875.00"].join("\n");
    const outcome = await importCsv(csv, "donations-2.csv");
    expect(outcome.reconcile?.accountsCreated).toEqual([]);
    expect(await db.account.count({ where: { firmId, name: "Donations" } })).toBe(1);
    const row = (await rows()).find((r) => r.description.includes("SMITH FAMILY"))!;
    expect(row.account?.code).toBe(1400);
  });

  it("keeps the created account inside the firm: another firm cannot see or post to it", async () => {
    const otherClient = await db.client.create({ data: { firmId: otherFirmId, businessName: "Other Co", entityType: "COMPANY" }, select: { id: true } });
    const visible = await accountsRepo.listPostableAccounts(otherFirmId, otherClient.id);
    expect(visible.some((a) => a.name === "Donations")).toBe(false);
    expect(visible.some((a) => a.code === 1400)).toBe(false);

    const created = await db.account.findFirst({ where: { firmId, name: "Donations" }, select: { id: true } });
    const resolved = await accountsRepo.resolveForClient(otherFirmId, otherClient.id, [created!.id]);
    expect(resolved).toEqual([]);
  });
});
