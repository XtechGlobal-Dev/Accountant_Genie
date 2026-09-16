/**
 * Scores the configured AI provider against tests/ai/golden-transactions.json.
 *
 *   npm run ai:golden
 *
 * This is the regression gate `.claude/skills/ai-classification` asks for, and
 * it is also how you choose a model: run it for each candidate and compare the
 * table, rather than picking an id and hoping.
 *
 * It answers one question above all others. Not "how accurate is it" — a model
 * that abstains on everything is useless but harmless. The question is: **how
 * often does it code something wrongly and still wave it through?** CLAUDE.md
 * puts that at 0.5% and calls it the number the business lives or dies on.
 *
 * It uses whichever provider .env configures, so with no keys at all it scores
 * MockProvider — which is a useful baseline: anything worth paying for should
 * beat 17 hardcoded regexes.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { AU_CHART_OF_ACCOUNTS } from "../src/au/coa.js";
import { getAIProvider } from "../src/ai/index.js";
import type { ClassificationInput, ClassificationResult } from "../src/ai/types.js";

// The environment may already be set (CI, a host): a missing .env is not an error.
try {
  process.loadEnvFile(".env");
} catch {
  // .env is absent — the environment is expected to provide the variables.
}

interface GoldenCase {
  date: string;
  description: string;
  amountCents: number;
  kind: "settled" | "policy" | "abstain";
  accountCode?: number;
  alsoAccept?: number[];
  why?: string;
}

const golden = JSON.parse(
  readFileSync(path.join(process.cwd(), "tests/ai/golden-transactions.json"), "utf8"),
) as { client: ClassificationInput["client"]; cases: GoldenCase[] };

/** Auto-processing threshold, read from the same place the engine reads it. */
const AUTO = Number(process.env.RECONCILE_AUTO_CONFIDENCE ?? 0.95);

/**
 * How many passes to score.
 *
 * Sampling parameters (`temperature`, `top_p`) have been removed from the
 * current models on both providers, so one pass is a sample rather than a
 * measurement — the same model scored 96.8% and 93.5% on consecutive runs.
 * Comparing models on a single pass would rank noise.
 */
const RUNS = Number(process.env.GOLDEN_RUNS ?? 3);

const accounts = AU_CHART_OF_ACCOUNTS.map((a) => ({
  code: a.code,
  name: a.name,
  type: a.type,
  gstTreatment: a.gstTreatment,
  description: a.description ?? null,
}));

function accepted(c: GoldenCase): number[] {
  return c.accountCode === undefined ? [] : [c.accountCode, ...(c.alsoAccept ?? [])];
}

/** What the engine would do with this proposal: wave it through, or ask a person. */
function wouldAutoProcess(r: ClassificationResult): boolean {
  return !r.needsReview && r.confidence >= AUTO && r.accountCode !== 0;
}

async function main() {
  const provider = getAIProvider();
  const input: ClassificationInput = {
    client: golden.client,
    accounts,
    memory: [], // A cold firm. Memory is measured separately; this is the AI tier alone.
    transactions: golden.cases.map((c, i) => ({
      ref: `g${i}`,
      description: c.description,
      amountCents: c.amountCents,
      date: c.date,
    })),
  };

  const n = golden.cases.length;
  const passes: Array<{ correct: number; abstained: number; falseAuto: number; damage: string[] }> = [];
  let meta: Awaited<ReturnType<typeof provider.classifyTransactions>>["meta"] | null = null;
  let elapsed = 0;

  for (let pass = 0; pass < RUNS; pass++) {
    const started = Date.now();
    const response = await provider.classifyTransactions(input);
    elapsed += Date.now() - started;
    meta = response.meta;

    if (response.failure) {
      console.error(`\n  provider failed: ${response.failure.kind} — ${response.failure.detail}\n`);
      process.exit(1);
    }

    const byRef = new Map(response.results.map((r) => [r.ref, r]));
    const scored = { correct: 0, abstained: 0, falseAuto: 0, damage: [] as string[] };

    golden.cases.forEach((c, i) => {
      const r = byRef.get(`g${i}`);
      if (!r) {
        scored.damage.push(`MISSING  ${c.description} — no result returned`);
        return;
      }
      const unknown = r.accountCode === 0;
      const ok = c.kind === "abstain" ? unknown || r.needsReview : accepted(c).includes(r.accountCode);

      if (ok) scored.correct++;
      if (c.kind === "abstain" && ok) scored.abstained++;

      // The failure that matters: confident, unreviewed, and not a right answer.
      if (!ok && wouldAutoProcess(r)) {
        scored.falseAuto++;
        const want = c.kind === "abstain" ? "review" : accepted(c).join(" or ");
        scored.damage.push(
          `AUTO-APPROVED WRONG  ${c.description}\n` +
            `      coded ${r.accountCode} at ${r.confidence.toFixed(2)} — expected ${want}\n` +
            `      "${r.reason}"`,
        );
      }
    });
    passes.push(scored);
  }

  const abstainTotal = golden.cases.filter((c) => c.kind === "abstain").length;
  const spread = (pick: (p: (typeof passes)[number]) => number) => {
    const v = passes.map(pick).sort((a, b) => a - b);
    const lo = v[0] ?? 0;
    const hi = v[v.length - 1] ?? 0;
    return lo === hi ? `${lo}` : `${lo}-${hi}`;
  };
  const worstCorrect = Math.min(...passes.map((p) => p.correct));
  const totalFalseAuto = passes.reduce((s, p) => s + p.falseAuto, 0);

  console.log(`\n  provider  ${meta?.provider} · ${meta?.model}`);
  console.log(`  prompt    ${meta?.promptVersion}`);
  console.log(`  passes    ${RUNS} × ${n} transactions in ${(elapsed / 1000).toFixed(1)}s\n`);

  // Sampling parameters are gone from the current models, so a single pass is a
  // sample, not a measurement. The spread is the honest number; the worst pass
  // is the one to plan around.
  console.log(`  correct              ${spread((p) => p.correct)} of ${n}   worst ${((worstCorrect / n) * 100).toFixed(1)}%`);
  console.log(`  abstained when right ${spread((p) => p.abstained)} of ${abstainTotal}`);
  console.log(`  FALSE AUTO-APPROVALS ${totalFalseAuto} across ${RUNS} passes   <- the number that matters\n`);

  const damage = [...new Set(passes.flatMap((p) => p.damage))];
  if (damage.length) {
    console.log("  What it got wrong and still waved through:\n");
    for (const d of damage) console.log(`    ${d}\n`);
  }

  // One confident error on 31 rows is already 3.2%, six times the ceiling.
  if (totalFalseAuto > 0) {
    console.log("  FAIL — CLAUDE.md puts the ceiling at 0.5%.\n");
    process.exitCode = 1;
  } else {
    console.log("  PASS — nothing wrong was auto-approved in any pass.\n");
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
