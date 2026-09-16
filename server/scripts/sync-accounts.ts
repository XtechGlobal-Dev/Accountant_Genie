/**
 * Apply `src/au/coa.ts` to the database without seeding demo data.
 *
 *   npm run db:sync-accounts
 *
 * Use this after changing the chart of accounts. `npm run db:seed` runs the
 * same sync, but also creates the demo firm — which a database with real
 * clients in it must never get.
 *
 * `server-only` throws outside the React server condition, so this runs under
 * `--conditions=react-server` (see the package script).
 */
process.loadEnvFile(".env");

const { syncSystemAccounts } = await import("../prisma/accounts-sync.js");
const { db } = await import("../src/core/db.js");

console.log("\nSyncing the system chart of accounts…\n");
const { created, updated, deleted, deactivated } = await syncSystemAccounts(db, (line) =>
  console.log(line),
);

console.log(
  `\n  ${created} created · ${updated} updated · ${deleted} removed · ${deactivated} deactivated`,
);

const total = await db.account.count({ where: { firmId: null, clientId: null, isActive: true } });
const flagged = await db.account.count({ where: { requiresVerification: true, isActive: true } });
console.log(`  ${total} active system accounts`);
if (flagged > 0) {
  console.log(`  ${flagged} flagged REQUIRES_VERIFICATION — clear these with the registered tax agent`);
}
console.log();

await db.$disconnect();

export {};
