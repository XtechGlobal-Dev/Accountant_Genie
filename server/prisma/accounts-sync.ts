import type { PrismaClient } from "../generated/prisma/client.js";
import { AU_CHART_OF_ACCOUNTS } from "../src/au/coa.js";

/**
 * The client is passed in rather than imported: the seed runs under plain
 * `tsx` with its own client, and importing `src/core/db` here would evaluate
 * it (and read DATABASE_URL) before the seed has loaded `.env`. The sync
 * script passes the app's singleton.
 */
type Db = Pick<PrismaClient, "account">;

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
  /**
   * Accounts left as they were because the chart gives their code a different
   * type or tax treatment and they have already been posted to. See
   * `syncSystemAccounts`.
   */
  conflicts: number;
}

/**
 * A code that has been posted to keeps its meaning.
 *
 * The chart is applied by code, so when a chart revision gives an existing
 * code a different account — 320 was "Subcontractor Payments" and became
 * "Bank Fees"; 720 was "Motor Vehicles" (GST on capital) and became "GST
 * Receivable" — an in-place update would quietly move every line ever posted
 * under the old meaning onto the new one, still carrying the old GST
 * snapshot. A subcontractor's $2,750 then reports as a bank fee claiming $250
 * at 1B, and a $40,000 ute brought forward reports as GST Receivable claiming
 * $3,636 — which is exactly what happened to the demo firm.
 *
 * So an account that has been posted to is not changed in type or treatment.
 * It is left exactly as it is, reported as a conflict, and the caller decides:
 * in development, purge and reseed; in production, the new account needs a
 * new code and the old one retires. Renaming or redescribing an account that
 * keeps its type and treatment is an ordinary edit and goes through.
 */
export async function syncSystemAccounts(
  db: Db,
  log: (line: string) => void = () => {},
): Promise<AccountSyncResult> {
  let created = 0;
  let updated = 0;
  let conflicts = 0;

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
      select: {
        id: true,
        name: true,
        type: true,
        gstTreatment: true,
        _count: { select: { journalLines: true, bankTransactions: true } },
      },
    });

    if (existing) {
      const meaningChanged = existing.type !== a.type || existing.gstTreatment !== a.gstTreatment;
      const inUse = existing._count.journalLines > 0 || existing._count.bankTransactions > 0;
      if (meaningChanged && inUse) {
        conflicts++;
        log(
          `  ! ${a.code} ${existing.name} (${existing.type}, ${existing.gstTreatment}) has been posted to and was NOT changed ` +
            `to ${a.name} (${a.type}, ${a.gstTreatment}) — give the new account a new code, or purge and reseed a development database`,
        );
        continue;
      }
      await db.account.update({ where: { id: existing.id }, data });
      updated++;
    } else {
      await db.account.create({ data });
      created++;
    }
  }

  const retired = await retireSystemAccounts(db, log);
  return { created, updated, conflicts, ...retired };
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
  db: Db,
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
