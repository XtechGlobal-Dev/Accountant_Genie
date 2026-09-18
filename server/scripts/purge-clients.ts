/**
 * Removes EVERY client in the database and everything that hangs off them.
 *
 * `npm run db:purge-clients`
 *
 * Firms, users, the chart of accounts (system and firm-level), tax rule
 * versions and firm-level audit rows stay. Client-level accounts, bank
 * accounts, transactions, imports (and their stored files), journals, assets,
 * loans, subcontractors, feed connections, BAS statements, jobs, memory rules
 * and client-scoped audit rows go. Accounting parents are `onDelete: Restrict`
 * on purpose, so this takes the tree apart from the leaves inward in one
 * transaction and rolls back if anything outside the client tree would change.
 *
 * Local development only.
 */
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "pg";

try {
  process.loadEnvFile(".env");
} catch {
  // .env is absent — the environment is expected to provide the variables.
}

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
  (select count(*)::int from "StatementImport") as imports,
  (select count(*)::int from "BankTransaction") as transactions,
  (select count(*)::int from "JournalEntry") as journals,
  (select count(*)::int from "JournalLine") as journal_lines,
  (select count(*)::int from "Asset") as assets,
  (select count(*)::int from "Loan") as loans,
  (select count(*)::int from "Subcontractor") as subcontractors,
  (select count(*)::int from "MemoryRule") as memory_rules,
  (select count(*)::int from "BasStatement") as bas_statements,
  (select count(*)::int from "Job") as jobs,
  (select count(*)::int from "BankFeedConnection") as feed_connections,
  (select count(*)::int from "AuditLog") as audit_rows,
  (select count(*)::int from "Account" where "clientId" is not null) as client_accounts,
  (select count(*)::int from "Account" where "clientId" is null) as shared_accounts,
  (select count(*)::int from "TaxRuleVersion") as tax_rule_versions`;

/** Leaves first. Every statement reaches only rows that belong to a client. */
const DELETES = [
  `delete from "UsageEvent" where "entityId" in (
     select id from "BankTransaction"
     union select id from "StatementImport"
     union select id from "Job" where "clientId" is not null)`,
  `delete from "BasStatementLine" where "statementId" in (select id from "BasStatement")`,
  `delete from "BasStatement"`,
  `delete from "JobEvent" where "jobId" in (select id from "Job" where "clientId" is not null)`,
  `delete from "Job" where "clientId" is not null`,
  `delete from "JournalLine"`,
  `delete from "JournalEntry"`,
  `delete from "BankTransaction"`,
  `delete from "StatementImport"`,
  `delete from "FeedSyncRun"`,
  `delete from "BankFeedRequest"`,
  `delete from "BankAccount"`,
  `delete from "BankFeedConnection"`,
  `delete from "MemoryRule" where "clientId" is not null`,
  `delete from "Asset"`,
  `delete from "Loan"`,
  `delete from "Subcontractor"`,
  `delete from "AccountVerification" where "accountId" in (select id from "Account" where "clientId" is not null)`,
  `delete from "Account" where "clientId" is not null`,
  `delete from "AuditLog" where "clientId" is not null`,
  `delete from "Partner"`,
  `delete from "Beneficiary"`,
  `delete from "Trustee"`,
  `delete from "ClientNote"`,
  `delete from "Client"`,
];

async function main() {
  const db = new Client({ connectionString: url });
  await db.connect();

  try {
    const clients = await db.query(
      `select c.id, c."businessName", f.name as firm from "Client" c join "Firm" f on f.id = c."firmId" order by f.name, c."businessName"`,
    );
    if (clients.rowCount === 0) {
      console.log("No clients in this database — nothing to do.");
      return;
    }

    // Files to remove from local storage once the rows are gone.
    const files = await db.query(
      `select "storagePath" as key from "StatementImport" where "storagePath" is not null
       union all select "logoKey" from "Client" where "logoKey" is not null`,
    );

    // Everything that must NOT move, counted before and after.
    const others = `select
      (select count(*)::int from "Firm") +
      (select count(*)::int from "User") +
      (select count(*)::int from "Account" where "clientId" is null) +
      (select count(*)::int from "TaxRuleVersion") +
      (select count(*)::int from "AuditLog" where "clientId" is null) +
      (select count(*)::int from "MemoryRule" where "clientId" is null) as n`;
    const othersBefore = (await db.query(others)).rows[0].n;
    const before = (await db.query(COUNTS)).rows[0];

    await db.query("begin");
    try {
      for (const statement of DELETES) await db.query(statement);
      const remaining = (await db.query(`select count(*)::int as n from "Client"`)).rows[0].n;
      if (remaining !== 0) throw new Error(`${remaining} clients still present`);
      const othersAfter = (await db.query(others)).rows[0].n;
      if (othersAfter !== othersBefore) throw new Error(`rows outside the client tree changed (${othersBefore} → ${othersAfter})`);
      await db.query("commit");
    } catch (error) {
      await db.query("rollback");
      throw error;
    }

    const root = join(process.cwd(), "storage");
    let removed = 0;
    for (const { key } of files.rows as { key: string }[]) {
      if (key.startsWith("/") || key.includes("..")) continue;
      await rm(join(root, key), { force: true });
      removed += 1;
    }

    const after = (await db.query(COUNTS)).rows[0];
    console.log(`Deleted ${clients.rowCount} clients and everything under them:\n`);
    for (const row of clients.rows) console.log(`  - ${row.businessName}  (${row.firm})`);
    console.log(`\n  table                before   after`);
    for (const key of Object.keys(before)) {
      console.log(`  ${key.padEnd(20)} ${String(before[key]).padStart(6)}  ${String(after[key]).padStart(6)}`);
    }
    console.log(`\nStored files removed: ${removed}`);
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error(`\nFailed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
