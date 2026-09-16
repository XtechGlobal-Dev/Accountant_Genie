import { PrismaPg } from "@prisma/adapter-pg";
import { randomBytes, scrypt } from "node:crypto";
import { PrismaClient } from "../generated/prisma/client.js";
import { syncSystemAccounts } from "./accounts-sync.js";
import { gstFromGross, naturalGross } from "../src/au/gst.js";
import { seedProposals } from "../src/modules/tax-rules/catalogue.js";
import type { GstTreatment } from "../generated/prisma/client.js";

// The environment may already be set (CI, a host): a missing .env is not an error.
try {
  process.loadEnvFile(".env");
} catch {
  // .env is absent — the environment is expected to provide the variables.
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const db = new PrismaClient({ adapter });

/** Same scheme as server/core/password.ts, inlined so the seed has no server-only import. */
function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("base64url");
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, 64, { N: 16_384 }, (error, key) => {
      if (error) reject(error);
      else resolve(`scrypt$16384$${salt}$${key.toString("base64url")}`);
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Demo journals                                                              */
/* -------------------------------------------------------------------------- */

interface SeedLine {
  code: number;
  debit?: number; // cents
  credit?: number; // cents
  description?: string;
  subcontractorId?: string;
}

interface SeedJournal {
  id: string;
  date: string; // YYYY-MM-DD
  source: "OPENING" | "MANUAL";
  reference?: string;
  description: string;
  lines: SeedLine[];
}

/**
 * A quarter of Horizon's books, posted the way the ledger service would post
 * them: GST from the account's treatment (gross / 11), snapshotted on the
 * line; totals equal by construction. Enough for the P&L, the BAS, the TPAR
 * and the balance sheet to show real figures in a demo.
 */
const SUBCONTRACTOR_ID = "demo-sub-formwork-plus";

const HORIZON_JOURNALS: SeedJournal[] = [
  {
    id: "demo-journal-horizon-opening",
    date: "2026-07-01",
    source: "OPENING",
    description: "Opening balances FY2027",
    lines: [
      { code: 701, debit: 4_250_000 },
      { code: 727, debit: 825_000, description: "Work in progress at cost" },
      { code: 725, debit: 4_000_000, description: "Stock on hand" },
      { code: 850, credit: 1_200_000, description: "Director loan" },
      { code: 900, credit: 100_000 },
      { code: 910, credit: 7_775_000 },
    ],
  },
  {
    id: "demo-journal-horizon-01",
    date: "2026-07-14",
    source: "MANUAL",
    reference: "INV-2041",
    description: "Progress claim — Kellyville site",
    lines: [
      { code: 701, debit: 1_100_000 },
      { code: 200, credit: 1_100_000 },
    ],
  },
  {
    id: "demo-journal-horizon-02",
    date: "2026-07-31",
    source: "MANUAL",
    description: "Workshop rent — July",
    lines: [
      { code: 480, debit: 330_000 },
      { code: 701, credit: 330_000 },
    ],
  },
  {
    id: "demo-journal-horizon-03",
    date: "2026-08-05",
    source: "MANUAL",
    description: "Account keeping fee",
    lines: [
      { code: 320, debit: 1_500 },
      { code: 701, credit: 1_500 },
    ],
  },
  {
    id: "demo-journal-horizon-04",
    date: "2026-08-20",
    source: "MANUAL",
    reference: "PAY-08",
    description: "Wages — August",
    lines: [
      { code: 600, debit: 480_000 },
      { code: 630, credit: 110_000, description: "PAYG withheld" },
      { code: 701, credit: 370_000 },
    ],
  },
  {
    id: "demo-journal-horizon-05",
    date: "2026-08-28",
    source: "MANUAL",
    description: "Fuel — ute",
    lines: [
      { code: 420, debit: 22_000 },
      { code: 701, credit: 22_000 },
    ],
  },
  {
    id: "demo-journal-horizon-06",
    date: "2026-09-02",
    source: "MANUAL",
    reference: "SUB-117",
    description: "Subcontractor — formwork",
    lines: [
      { code: 530, debit: 275_000, subcontractorId: SUBCONTRACTOR_ID },
      { code: 701, credit: 275_000 },
    ],
  },
];

async function seedJournals(clientId: string, postedById: string) {
  const accounts = await db.account.findMany({
    where: { firmId: null, clientId: null },
    select: { id: true, code: true, gstTreatment: true },
  });
  const byCode = new Map(accounts.map((a) => [a.code, a]));

  let posted = 0;
  for (const journal of HORIZON_JOURNALS) {
    const exists = await db.journalEntry.findUnique({
      where: { id: journal.id },
      select: { id: true },
    });
    if (exists) continue;

    const lines = journal.lines.map((line) => {
      const account = byCode.get(line.code);
      if (!account) throw new Error(`Seed journal references unknown account ${line.code}`);
      const debitCents = line.debit ?? 0;
      const creditCents = line.credit ?? 0;
      const treatment: GstTreatment = account.gstTreatment;
      const gross = naturalGross(treatment, debitCents, creditCents);
      return {
        accountId: account.id,
        description: line.description ?? null,
        debitCents,
        creditCents,
        gstCents: gstFromGross(gross, treatment),
        gstTreatment: treatment,
        subcontractorId: line.subcontractorId ?? null,
      };
    });

    const debits = lines.reduce((sum, l) => sum + l.debitCents, 0);
    const credits = lines.reduce((sum, l) => sum + l.creditCents, 0);
    if (debits !== credits) {
      throw new Error(`Seed journal ${journal.id} does not balance: ${debits} vs ${credits}`);
    }

    await db.journalEntry.create({
      data: {
        id: journal.id,
        clientId,
        date: new Date(`${journal.date}T00:00:00.000Z`),
        reference: journal.reference ?? null,
        description: journal.description,
        source: journal.source,
        totalCents: debits,
        postedById,
        lines: { create: lines },
      },
    });
    posted++;
  }
  return posted;
}

async function main() {
  console.log("Seeding Accountant Genie…\n");

  // ---------------------------------------------------------------- Firm
  const firm = await db.firm.upsert({
    where: { id: "demo-firm" },
    update: {},
    create: {
      id: "demo-firm",
      name: "Meridian Accounting",
      abn: "51 824 753 556",
      planCode: "TRIAL",
    },
  });
  console.log(`  firm     ${firm.name}`);

  const demoPassword = process.env.DEMO_PASSWORD?.trim() || "Ledgerly-demo-2026";
  const passwordHash = await hashPassword(demoPassword);
  const user = await db.user.upsert({
    where: { email: "demo@meridian.test" },
    update: { passwordHash, role: "OWNER", emailVerifiedAt: new Date(), mustChangePassword: false },
    create: {
      firmId: firm.id,
      email: "demo@meridian.test",
      name: "Demo Accountant",
      role: "OWNER",
      isTaxAgent: true,
      agentNumber: "00000000",
      passwordHash,
      emailVerifiedAt: new Date(),
    },
  });
  console.log(`  user     ${user.name} <${user.email}>  password: ${demoPassword}`);

  // -------------------------------------------------- Chart of accounts
  const { created, updated, deleted, deactivated } = await syncSystemAccounts(db, (line) =>
    console.log(line),
  );
  console.log(
    `  accounts ${created} created, ${updated} updated, ${deleted} removed, ${deactivated} deactivated`,
  );

  const flagged = await db.account.count({ where: { requiresVerification: true } });
  if (flagged > 0) {
    console.log(`           ${flagged} flagged REQUIRES_VERIFICATION for the tax advisor`);
  }

  // ------------------------------------------------------------- Clients
  // Two entity types so the demo can show how entity choice reshapes setup.
  const horizon = await db.client.upsert({
    where: { id: "demo-client-company" },
    update: {},
    create: {
      id: "demo-client-company",
      firmId: firm.id,
      businessName: "Horizon Trade Services",
      legalName: "Horizon Trade Services Pty Ltd",
      abn: "29 614 302 012",
      industry: "Construction",
      entityType: "COMPANY",
      gstRegistered: true,
      gstBasis: "CASH",
      basFrequency: "QUARTERLY",
      incomeTaxRatePercent: 25,
    },
  });
  console.log(`  client   ${horizon.businessName} (Company)`);

  const whitlam = await db.client.upsert({
    where: { id: "demo-client-sole-trader" },
    update: {},
    create: {
      id: "demo-client-sole-trader",
      firmId: firm.id,
      businessName: "J. Whitlam Consulting",
      abn: "74 108 552 480",
      industry: "Professional Services",
      entityType: "SOLE_TRADER",
      gstRegistered: true,
      gstBasis: "CASH",
      basFrequency: "QUARTERLY",
    },
  });
  console.log(`  client   ${whitlam.businessName} (Sole Trader)`);

  // -------------------------------------------------------- Bank accounts
  for (const [id, clientId, name] of [
    ["demo-bank-horizon", horizon.id, "Business Transaction Account"],
    ["demo-bank-whitlam", whitlam.id, "Everyday Business Account"],
  ] as const) {
    await db.bankAccount.upsert({
      where: { id },
      update: {},
      create: {
        id,
        clientId,
        name,
        kind: "BANK",
        source: "MANUAL",
        isCashAtBank: true,
      },
    });
  }
  console.log(`  banks    2 manual accounts`);

  // Client notes — the kind of context a real firm records.
  await db.clientNote.deleteMany({ where: { clientId: horizon.id } });
  await db.clientNote.create({
    data: {
      clientId: horizon.id,
      title: "Vehicle private use",
      body: "Ute is 80% business use. Apportion motor vehicle expenses before finalising.",
    },
  });

  // ----------------------------------------------------------- Registers
  await db.subcontractor.upsert({
    where: { id: SUBCONTRACTOR_ID },
    update: {},
    create: {
      id: SUBCONTRACTOR_ID,
      clientId: horizon.id,
      name: "Formwork Plus Pty Ltd",
      abn: "83 221 904 002",
      email: "accounts@formworkplus.test",
    },
  });
  await db.asset.upsert({
    where: { id: "demo-asset-hilux" },
    update: {},
    create: {
      id: "demo-asset-hilux",
      clientId: horizon.id,
      name: "Toyota HiLux SR5",
      description: "Site ute",
      costCents: 4_000_000,
      purchaseDate: new Date("2025-07-01T00:00:00.000Z"),
      method: "DIMINISHING_VALUE",
      effectiveLifeMonths: 96,
      privateUseBasisPoints: 2_000,
      isCar: true,
    },
  });
  await db.loan.upsert({
    where: { id: "demo-loan-equipment" },
    update: {},
    create: {
      id: "demo-loan-equipment",
      clientId: horizon.id,
      lender: "Westpac Equipment Finance",
      description: "Excavator attachment",
      principalCents: 1_200_000,
      interestRateBasisPoints: 1_200,
      startDate: new Date("2026-07-01T00:00:00.000Z"),
      termMonths: 12,
      repaymentCents: 106_619,
      frequency: "MONTHLY",
    },
  });
  console.log(`  register 1 subcontractor, 1 asset, 1 loan`);

  // ------------------------------------------------------------ Tax rules
  // Mapping proposals only, never figures: each sits as PENDING_VERIFICATION
  // for THIS firm until its registered tax advisor signs it off under
  // Settings → Tax rules. Rules are firm-scoped; the demo firm gets its own.
  const existingCodes = new Set(
    (await db.taxRuleVersion.findMany({ where: { firmId: firm.id }, select: { code: true }, distinct: ["code"] })).map((r) => r.code),
  );
  let proposed = 0;
  for (const proposal of seedProposals()) {
    if (existingCodes.has(proposal.code)) {
      // Unverified proposals follow the catalogue (the chart's codes moved); verified versions are never touched.
      await db.taxRuleVersion.updateMany({
        where: { firmId: firm.id, code: proposal.code, status: "PENDING_VERIFICATION", valueText: { not: proposal.valueText }, note: proposal.note },
        data: { valueText: proposal.valueText, label: proposal.label, description: proposal.description },
      });
      continue;
    }
    await db.taxRuleVersion.create({ data: { firmId: firm.id, ...proposal } });
    proposed += 1;
  }
  console.log(`  tax rules ${proposed} proposals pending verification (${seedProposals().length - proposed} already present)`);

  // ------------------------------------------------------------ Journals
  const posted = await seedJournals(horizon.id, user.id);
  console.log(`  journals ${posted} posted for ${horizon.businessName} (${HORIZON_JOURNALS.length - posted} already present)`);

  console.log("\nDone. Sign in at /sign-in with demo@meridian.test; the code is printed to this log.");
  console.log("Sample statement to upload: samples/horizon-q1-fy2027.csv");
}

main()
  .catch((e) => {
    console.error("\nSeed failed:\n", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
