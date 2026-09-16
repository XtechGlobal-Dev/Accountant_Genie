/**
 * Gives every existing firm the tax rule proposals it should have started with.
 *
 *   npm run db:backfill-tax-rules
 *
 * `seedProposalsForFirm` runs inside firm creation (`auth/service.ts`), so a
 * firm created today is never without its proposals. Firms that predate the
 * hardening migration are: `20260916000008_hardening` made TaxRuleVersion
 * firm-scoped, and did it by deleting the platform-wide rows — correctly, they
 * were unverified seed proposals and a rule now belongs to the firm whose
 * registered agent verifies it — but nothing re-creates them for the firms that
 * already existed. This is that step.
 *
 * Idempotent, and safe on a firm already backfilled: a firm holding any version
 * of a rule is left alone, and a VERIFIED version is never touched — versions
 * are never edited in place.
 *
 * It verifies nothing. Every proposal lands PENDING_VERIFICATION and affects no
 * report until that firm's registered tax advisor signs it off under
 * Settings → Tax rules.
 *
 * `server-only` throws outside the React server condition, so this runs under
 * `--conditions=react-server` (see the package script).
 */
// The environment may already be set (CI, a host): a missing .env is not an error.
try {
  process.loadEnvFile(".env");
} catch {
  // .env is absent — the environment is expected to provide the variables.
}

const { db } = await import("../src/core/db.js");
const { seedProposalsForFirm } = await import("../src/modules/tax-rules/service.js");

const firms = await db.firm.findMany({ select: { id: true, name: true }, orderBy: { createdAt: "asc" } });

if (firms.length === 0) {
  console.log("\nNo firms — nothing to backfill.\n");
} else {
  console.log(`\nBackfilling tax rule proposals for ${firms.length} firm(s)…\n`);

  let total = 0;
  for (const firm of firms) {
    // One transaction per firm: a firm that fails leaves the others done.
    const created = await db.$transaction((tx) => seedProposalsForFirm(tx, firm.id));
    total += created;
    console.log(`  ${firm.name} — ${created === 0 ? "already complete" : `${created} proposal(s) created`}`);
  }

  console.log(
    total === 0
      ? `\n  nothing to do\n`
      : `\n  ${total} proposal(s) created, all PENDING_VERIFICATION — a registered tax advisor\n  must sign each off under Settings → Tax rules before it affects any report.\n`,
  );
}

await db.$disconnect();

export {};
