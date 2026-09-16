/**
 * Removes the seeded demo firm and everything that hangs off it.
 *
 * `npm run db:purge-demo`
 *
 * The seed (`prisma/seed.ts`) creates one firm, "Meridian Accounting" with the
 * fixed id `demo-firm`, plus its user, two clients, bank accounts, journals,
 * an asset, a loan and a subcontractor. Accounting parents are `onDelete:
 * Restrict` on purpose — a firm delete can never take a ledger, its bank
 * history or its audit trail with it — so this script takes the demo apart
 * from the leaves inward, in one transaction, and rolls back if any other
 * firm's rows would change. Nothing else is touched:
 *
 *   - the system chart of accounts has no firm and stays
 *   - every other firm's rows are left exactly as they are
 *
 * `npm run dev` seeds only when the Firm table is empty, so once a real firm
 * exists the demo is not recreated. `npm run db:seed` would bring it back.
 */
import { Client } from "pg";

process.loadEnvFile(".env");

const DEMO_FIRM_ID = "demo-firm";
const DEMO_FIRM_NAME = "Meridian Accounting";

const url = process.env.DIRECT_DATABASE_URL;
if (!url) {
  console.error("DIRECT_DATABASE_URL is not set. Copy .env.example to .env.");
  process.exit(1);
}

const COUNTS = `select
  (select count(*)::int from "Firm") as firms,
  (select count(*)::int from "User") as users,
  (select count(*)::int from "Client") as clients,
  (select count(*)::int from "BankAccount") as bank_accounts,
  (select count(*)::int from "BankTransaction") as transactions,
  (select count(*)::int from "JournalEntry") as journals,
  (select count(*)::int from "Asset") as assets,
  (select count(*)::int from "Loan") as loans,
  (select count(*)::int from "Subcontractor") as subcontractors,
  (select count(*)::int from "MemoryRule") as memory_rules,
  (select count(*)::int from "AuditLog") as audit_rows,
  (select count(*)::int from "Account" where "firmId" is null) as system_accounts,
  (select count(*)::int from "TaxRuleVersion") as tax_rule_versions`;

/** Leaves first. Every statement is scoped to the demo firm. */
const DELETES = [
  `delete from "UsageEvent" where "firmId" = $1`,
  `delete from "BasStatementLine" where "statementId" in (select s.id from "BasStatement" s join "Client" c on c.id = s."clientId" where c."firmId" = $1)`,
  `delete from "BasStatement" where "clientId" in (select id from "Client" where "firmId" = $1)`,
  `delete from "JobEvent" where "jobId" in (select id from "Job" where "firmId" = $1)`,
  `delete from "Job" where "firmId" = $1`,
  `delete from "JournalLine" where "journalEntryId" in (select e.id from "JournalEntry" e join "Client" c on c.id = e."clientId" where c."firmId" = $1)`,
  `delete from "JournalEntry" where "clientId" in (select id from "Client" where "firmId" = $1)`,
  `delete from "BankTransaction" where "bankAccountId" in (select b.id from "BankAccount" b join "Client" c on c.id = b."clientId" where c."firmId" = $1)`,
  `delete from "StatementImport" where "bankAccountId" in (select b.id from "BankAccount" b join "Client" c on c.id = b."clientId" where c."firmId" = $1)`,
  `delete from "FeedSyncRun" where "clientId" in (select id from "Client" where "firmId" = $1)`,
  `delete from "BankFeedRequest" where "clientId" in (select id from "Client" where "firmId" = $1)`,
  `delete from "BankAccount" where "clientId" in (select id from "Client" where "firmId" = $1)`,
  `delete from "BankFeedConnection" where "clientId" in (select id from "Client" where "firmId" = $1)`,
  `delete from "MemoryRule" where "firmId" = $1`,
  `delete from "Asset" where "clientId" in (select id from "Client" where "firmId" = $1)`,
  `delete from "Loan" where "clientId" in (select id from "Client" where "firmId" = $1)`,
  `delete from "Subcontractor" where "clientId" in (select id from "Client" where "firmId" = $1)`,
  `delete from "AccountVerification" where "firmId" = $1`,
  `delete from "Account" where "firmId" = $1`,
  `delete from "TaxRuleVersion" where "firmId" = $1`,
  `delete from "AuditLog" where "firmId" = $1`,
  `delete from "Partner" where "clientId" in (select id from "Client" where "firmId" = $1)`,
  `delete from "Beneficiary" where "clientId" in (select id from "Client" where "firmId" = $1)`,
  `delete from "Trustee" where "clientId" in (select id from "Client" where "firmId" = $1)`,
  `delete from "ClientNote" where "clientId" in (select id from "Client" where "firmId" = $1)`,
  `delete from "Client" where "firmId" = $1`,
  `delete from "TrustedDevice" where "userId" in (select id from "User" where "firmId" = $1)`,
  `delete from "OtpCode" where "userId" in (select id from "User" where "firmId" = $1)`,
  `delete from "Session" where "userId" in (select id from "User" where "firmId" = $1)`,
  `delete from "User" where "firmId" = $1`,
  `delete from "Firm" where id = $1 and name = $2`,
];

async function main() {
  const db = new Client({ connectionString: url });
  await db.connect();

  try {
    const demo = await db.query(`select id, name from "Firm" where id = $1`, [DEMO_FIRM_ID]);
    if (demo.rowCount === 0) {
      console.log(`No demo firm (${DEMO_FIRM_ID}) in this database — nothing to do.`);
      return;
    }
    if (demo.rows[0].name !== DEMO_FIRM_NAME) {
      throw new Error(`Firm ${DEMO_FIRM_ID} is named "${demo.rows[0].name}", not "${DEMO_FIRM_NAME}" — refusing to delete.`);
    }

    // Everything that is NOT the demo firm, counted before and after, so a
    // delete that reached further than expected aborts the whole thing.
    const others = `select
      (select count(*)::int from "Client" where "firmId" <> $1) +
      (select count(*)::int from "AuditLog" where "firmId" <> $1) +
      (select count(*)::int from "Account" where "firmId" is null) as n`;
    const othersBefore = (await db.query(others, [DEMO_FIRM_ID])).rows[0].n;
    const before = (await db.query(COUNTS)).rows[0];

    await db.query("begin");
    try {
      for (const statement of DELETES) {
        const params = statement.includes("$2") ? [DEMO_FIRM_ID, DEMO_FIRM_NAME] : [DEMO_FIRM_ID];
        const result = await db.query(statement, params);
        if (statement.startsWith(`delete from "Firm"`) && result.rowCount !== 1) {
          throw new Error(`expected to delete one firm, deleted ${result.rowCount}`);
        }
      }

      const othersAfter = (await db.query(others, [DEMO_FIRM_ID])).rows[0].n;
      if (othersAfter !== othersBefore) throw new Error(`other firms' rows changed (${othersBefore} → ${othersAfter})`);

      await db.query("commit");
    } catch (error) {
      await db.query("rollback");
      throw error;
    }

    const after = (await db.query(COUNTS)).rows[0];
    console.log(`Deleted demo firm "${DEMO_FIRM_NAME}" and everything under it.\n`);
    console.log("  table                before   after");
    for (const key of Object.keys(before)) {
      console.log(`  ${key.padEnd(20)} ${String(before[key]).padStart(6)}  ${String(after[key]).padStart(6)}`);
    }
    const firms = (await db.query(`select name from "Firm" order by name`)).rows.map((r) => r.name);
    console.log(`\nFirms remaining: ${firms.length ? firms.join(", ") : "none"}`);
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error(`\nFailed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
