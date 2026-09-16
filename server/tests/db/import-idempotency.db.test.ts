import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/core/db";
import { setAIProvider, MockProvider } from "@/server/ai";
import * as ingest from "@/server/modules/ingest/service";
import { purgeFirms } from "../helpers/purge-firm";

/**
 * The standing idempotency test the jobs-and-audit skill asks for: run the
 * import twice, assert the row count is unchanged. The unique fingerprint is
 * what makes it structurally impossible; this proves it stayed that way.
 */

process.loadEnvFile?.(".env");

const STAMP = Date.now();
let firmId = "";
let userId = "";
let bankAccountId = "";

const CSV = [
  "Date,Description,Amount,Balance",
  "01/07/2026,BUNNINGS 1234 ALEXANDRIA,-121.00,5000.00",
  "02/07/2026,PAYMENT RECEIVED INV 44,1100.00,6100.00",
  "03/07/2026,MONTHLY ACCOUNT FEE,-10.00,6090.00",
].join("\n");

const report = async () => undefined;

beforeAll(async () => {
  setAIProvider(new MockProvider());
  const firm = await db.firm.create({ data: { name: `Import DB ${STAMP}` }, select: { id: true } });
  firmId = firm.id;
  const user = await db.user.create({
    data: { firmId, email: `import-db-${STAMP}@example.test`, name: "Import Tester", role: "OWNER" },
    select: { id: true },
  });
  userId = user.id;
  const client = await db.client.create({ data: { firmId, businessName: "Import Co", entityType: "COMPANY" }, select: { id: true } });
  const bank = await db.bankAccount.create({ data: { clientId: client.id, name: "Operating", isCashAtBank: true }, select: { id: true } });
  bankAccountId = bank.id;
});

afterAll(async () => {
  await purgeFirms([firmId]);
  await db.$disconnect();
});

describe("statement import", () => {
  it("run twice creates no duplicate transactions, and the audit row lands with the import", async () => {
    const first = await ingest.importStatement(firmId, userId, { bankAccountId, filename: "july.csv", size: CSV.length }, Buffer.from(CSV));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    await ingest.processImport(firmId, userId, first.importId, report);

    const afterFirst = await db.bankTransaction.count({ where: { bankAccountId } });
    expect(afterFirst).toBe(3);
    expect(await db.auditLog.count({ where: { firmId, action: "STATEMENT_IMPORTED", entityId: first.importId } })).toBe(1);

    // The same file again: a second import row, zero new transactions.
    const second = await ingest.importStatement(firmId, userId, { bankAccountId, filename: "july.csv", size: CSV.length }, Buffer.from(CSV));
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    await ingest.processImport(firmId, userId, second.importId, report);

    expect(await db.bankTransaction.count({ where: { bankAccountId } })).toBe(afterFirst);
    const outcome = await ingest.getImportOutcome(firmId, second.importId);
    expect(outcome?.duplicateCount).toBe(3);
    expect(outcome?.insertedCount).toBe(0);

    // Re-running the job for the first import is a no-op too.
    await ingest.processImport(firmId, userId, first.importId, report);
    expect(await db.bankTransaction.count({ where: { bankAccountId } })).toBe(afterFirst);
  });

  it("refuses a file with no readable rows as a terminal failure, not a retry", async () => {
    const empty = await ingest.importStatement(firmId, userId, { bankAccountId, filename: "empty.csv", size: 30 }, Buffer.from("Date,Description,Amount\n"));
    expect(empty.ok).toBe(true);
    if (!empty.ok) return;
    await expect(ingest.processImport(firmId, userId, empty.importId, report)).rejects.toMatchObject({ name: "TerminalJobError" });
  });
});
