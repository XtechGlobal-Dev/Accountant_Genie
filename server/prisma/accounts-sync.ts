import { db } from "../src/core/db.js";
import { AU_CHART_OF_ACCOUNTS } from "../src/au/coa.js";

/**
 * Bring the system chart of accounts in the database into line with
 * `src/au/coa.ts`.
 *
 * Separate from `seed.ts` because replacing the chart and seeding demo data
 * are different jobs: a firm with real clients needs the first and must never
 * get the second. `seed.ts` imports this; `npm run db:sync-accounts` runs it
 * on its own.
 *
 * System accounts are the rows with `firmId` and `clientId` both null — the
 * built-ins every firm shares. A firm's own custom accounts (code ≥ 1000) are
 * never touched here.
 */

export interface AccountSyncResult {
  created: number;
  updated: number;
  deleted: number;
  deactivated: number;
}

export async function syncSystemAccounts(
  log: (line: string) => void = () => {},
): Promise<AccountSyncResult> {
  let created = 0;
  let updated = 0;

  for (const a of AU_CHART_OF_ACCOUNTS) {
    const data = {
      code: a.code,
      name: a.name,
      type: a.type,
      gstTreatment: a.gstTreatment,
      description: a.description ?? null,
      isCashAtBank: a.isCashAtBank ?? false,
      requiresVerification: a.requiresVerification ?? false,
      taxNote: a.taxNote ?? null,
      isSystem: true,
      isActive: true,
      firmId: null,
      clientId: null,
    };

    // Uniqueness of (code, NULL, NULL) is enforced by the `NULLS NOT DISTINCT`
    // index from migration 20260908000001_constraints. This lookup is kept
    // because local development uses `db push`, which does not apply it.
    const existing = await db.account.findFirst({
      where: { code: a.code, firmId: null, clientId: null },
      select: { id: true },
    });

    if (existing) {
      await db.account.update({ where: { id: existing.id }, data });
      updated++;
    } else {
      await db.account.create({ data });
      created++;
    }
  }

  const retired = await retireSystemAccounts(log);
  return { created, updated, ...retired };
}

/**
 * System accounts the chart no longer contains.
 *
 * Replacing a chart is not additive — codes that used to mean something are
 * gone, and leaving them behind shows an accountant a list that mixes two
 * charts. But an account that has been posted to is accounting history:
 * deleting it would orphan a journal line, and §6 of CLAUDE.md forbids
 * hard-deleting accounting records.
 *
 * So unused accounts are deleted and used ones are DEACTIVATED. A deactivated
 * account cannot be coded to again, and every report that already references
 * it still reproduces.
 */
async function retireSystemAccounts(
  log: (line: string) => void,
): Promise<{ deleted: number; deactivated: number }> {
  const keep = AU_CHART_OF_ACCOUNTS.map((a) => a.code);

  const obsolete = await db.account.findMany({
    where: { firmId: null, clientId: null, code: { notIn: keep } },
    select: {
      id: true,
      code: true,
      name: true,
      _count: { select: { journalLines: true, bankTransactions: true, memoryRules: true } },
    },
    orderBy: { code: "asc" },
  });

  let deleted = 0;
  let deactivated = 0;

  for (const account of obsolete) {
    const inUse =
      account._count.journalLines > 0 ||
      account._count.bankTransactions > 0 ||
      account._count.memoryRules > 0;

    if (inUse) {
      await db.account.update({ where: { id: account.id }, data: { isActive: false } });
      deactivated++;
      log(`  kept ${account.code} ${account.name} — posted to, deactivated instead of deleted`);
    } else {
      await db.account.delete({ where: { id: account.id } });
      deleted++;
    }
  }

  return { deleted, deactivated };
}
