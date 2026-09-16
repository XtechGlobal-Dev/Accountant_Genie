import "server-only";

import { db } from "@/server/core/db";
import { recordAudit } from "@/server/core/audit";
import { getAIProvider, type ClassificationResult } from "@/server/ai";
import { gstFromGross } from "@/server/au/gst";
import { CODE_UNKNOWN } from "@/server/au/coa";
import * as accounts from "@/server/modules/accounts/repository";
import * as clients from "@/server/modules/clients/repository";
import { treatmentAllowedFor } from "@/shared/account-rules";
import type { AccountType, ClassificationSource, GstTreatment } from "@/shared/enums";
import type { ReconcileStats } from "@/shared/contracts/transaction";
import { RULES_VERSION, reconcileConfig } from "./config";
import { matchMemory, type MemoryCandidate } from "./memory";
import * as repo from "./repository";
import { scoreRisk } from "./risk";
import { applyRules, RULES } from "./rules";

/**
 * The reconciliation pipeline, in the order the skill prescribes:
 *
 *   coding memory → deterministic rules → candidate accounts → AI (only what
 *   survives) → validation gate → GST engine → risk → route
 *
 * Every stage may answer Unknown. Nothing here writes to the ledger: the
 * output is a coding on the bank transaction plus a flag saying whether a
 * person has to look before it can be accepted. Acceptance — and the journal
 * — is a human act in `service.ts`, and that is also where the journal is
 * proven to balance: a bank posting is built from mirrored lines, so an
 * unbalanced entry is unrepresentable rather than merely checked.
 *
 * See .claude/skills/reconciliation-engine/SKILL.md and ai-classification.
 */

interface VisibleAccount {
  id: string;
  code: number;
  name: string;
  type: AccountType;
  gstTreatment: GstTreatment;
}

interface Decision {
  accountId: string;
  accountType: AccountType;
  gstTreatment: GstTreatment;
  source: ClassificationSource;
  confidence: number;
  reasoning: string;
  needsReview: boolean;
  memoryRuleId: string | null;
  meta: Record<string, string | number | boolean | null | Record<string, string | number | boolean | null>>;
}

/** The engine can always say "I don't know". This is that answer. */
function unknownDecision(unknown: VisibleAccount, reasoning: string, source: ClassificationSource, meta: Decision["meta"]): Decision {
  return {
    accountId: unknown.id,
    accountType: unknown.type,
    gstTreatment: "UNALLOCATED",
    source,
    confidence: 0,
    reasoning,
    needsReview: true,
    memoryRuleId: null,
    meta,
  };
}

export async function runEngine(
  firmId: string,
  userId: string | null,
  clientId: string,
  ids?: readonly string[],
): Promise<ReconcileStats | null> {
  const client = await clients.findClientDetail(firmId, clientId);
  if (!client) return null;

  const config = reconcileConfig();
  const [transactions, visible, memoryRows, codings] = await Promise.all([
    repo.listForEngine(firmId, client.id, ids),
    accounts.listPostableAccounts(firmId, client.id),
    repo.listMemoryForClient(firmId, client.id),
    repo.reviewedCodings(firmId, client.id),
  ]);

  const stats: ReconcileStats = {
    processed: 0,
    byMemory: 0,
    byRule: 0,
    byAi: 0,
    unknown: 0,
    needsReview: 0,
    autoCoded: 0,
    aiFailure: null,
    preAiRatio: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0 },
    warnings: [],
  };
  if (transactions.length === 0) return stats;

  // The Unknown sentinel is not "postable", so it is looked up separately.
  const unknownRow = await repo.findSystemAccountByCode(CODE_UNKNOWN);
  if (!unknownRow) throw new Error("System account 0 (Unknown) is missing — run the seed");
  const unknown: VisibleAccount = {
    id: unknownRow.id,
    code: CODE_UNKNOWN,
    name: "Unknown",
    type: "UNKNOWN",
    gstTreatment: "UNALLOCATED",
  };

  const byId = new Map<string, VisibleAccount>(visible.map((a) => [a.id, a]));
  const byCode = new Map<number, VisibleAccount>(visible.map((a) => [a.code, a]));

  // Memory rules are re-validated before use: a rule pointing at an account
  // that is now inactive, or whose treatment no longer fits, does not apply.
  // A rule skipped here is counted, so a firm can see its rules have rotted.
  let staleMemoryRules = 0;
  const memory: MemoryCandidate[] = memoryRows
    .filter((rule) => {
      const ok =
        rule.account.isActive &&
        rule.account.type !== "UNKNOWN" &&
        treatmentAllowedFor(rule.account.type as Exclude<AccountType, "UNKNOWN">, rule.gstTreatment);
      if (!ok) staleMemoryRules += 1;
      return ok;
    })
    .map((rule) => ({
      id: rule.id,
      clientId: rule.clientId,
      matchType: rule.matchType,
      pattern: rule.pattern,
      accountId: rule.accountId,
      gstTreatment: rule.gstTreatment,
      evidenceCount: rule.evidenceCount,
    }));
  const memoryVersion = `memory-${memoryRows.length}`;
  if (staleMemoryRules > 0) {
    stats.warnings.push(`${staleMemoryRules} Coding Memory rule${staleMemoryRules === 1 ? "" : "s"} point at an inactive account or an invalid treatment and were skipped — review them on the Coding Memory page`);
  }

  const decisions = new Map<string, Decision>();
  const forAi: typeof transactions = [];
  const stamp = () => new Date().toISOString();

  for (const t of transactions) {
    const hit = matchMemory(memory, t.normalised);
    if (hit) {
      const account = byId.get(hit.accountId);
      if (account) {
        decisions.set(t.id, {
          accountId: account.id,
          accountType: account.type,
          gstTreatment: hit.gstTreatment,
          source: "MEMORY",
          confidence: 1,
          reasoning: `Coding Memory: "${hit.pattern}" → ${account.code} ${account.name}`,
          needsReview: false,
          memoryRuleId: hit.id,
          meta: { tier: "memory", rulesVersion: RULES_VERSION, memoryVersion, decidedAt: stamp() },
        });
        continue;
      }
    }

    const rule = applyRules(t.normalised);
    if (rule) {
      const account = byCode.get(rule.accountCode);
      if (account && treatmentAllowedFor(account.type as Exclude<AccountType, "UNKNOWN">, rule.gstTreatment)) {
        decisions.set(t.id, {
          accountId: account.id,
          accountType: account.type,
          gstTreatment: rule.gstTreatment,
          source: "RULE",
          confidence: 1,
          reasoning: rule.reason,
          needsReview: rule.needsReview,
          memoryRuleId: null,
          meta: { tier: "rule", rule: rule.rule, rulesVersion: RULES_VERSION, memoryVersion, decidedAt: stamp() },
        });
        continue;
      }
    }

    forAi.push(t);
  }

  // The AI tier, batched. A refusal or a failure routes the whole batch to
  // review as Unknown — never to a default coding.
  if (forAi.length > 0) {
    const provider = getAIProvider();
    // description is what separates two similarly named accounts, so it is
    // part of what the model sees rather than withheld.
    const chart = visible.map((a) => ({
      code: a.code,
      name: a.name,
      type: a.type,
      gstTreatment: a.gstTreatment,
      description: a.description,
    }));
    const hints = memory.slice(0, 60).map((m) => ({
      pattern: m.pattern,
      accountCode: byId.get(m.accountId)?.code ?? 0,
      gstTreatment: m.gstTreatment,
    }));

    // Candidate generation: the accounts this client's people have actually
    // used — reviewed codings, memory targets, rule targets — as a short list
    // the model prefers. Never a restriction: the gate validates against the
    // whole chart, and Unknown is always allowed.
    const candidateIds = new Set<string>();
    for (const set of codings.values()) for (const id of set) candidateIds.add(id);
    for (const m of memory) candidateIds.add(m.accountId);
    const candidateCodes = [...candidateIds]
      .map((id) => byId.get(id)?.code)
      .filter((code): code is number => code !== undefined);
    for (const rule of RULES) if (byCode.has(rule.accountCode)) candidateCodes.push(rule.accountCode);

    for (let i = 0; i < forAi.length; i += config.batchSize) {
      const batch = forAi.slice(i, i + config.batchSize);
      const response = await provider.classifyTransactions({
        transactions: batch.map((t) => ({
          ref: t.id,
          description: t.description,
          amountCents: t.amountCents,
          date: t.date.toISOString().slice(0, 10),
          feedCategory: t.feedCategory,
          feedSubcategory: t.feedSubcategory,
          merchantCode: t.feedMerchantCode,
        })),
        client: {
          industry: client.industry,
          entityType: client.entityType,
          gstRegistered: client.gstRegistered,
        },
        accounts: chart,
        memory: hints,
        candidateCodes: [...new Set(candidateCodes)].sort((a, b) => a - b),
      });

      stats.tokens.calls += 1;
      stats.tokens.input += response.meta.inputTokens ?? 0;
      stats.tokens.output += response.meta.outputTokens ?? 0;
      stats.tokens.cacheRead += response.meta.cacheReadTokens ?? 0;
      stats.tokens.cacheWrite += response.meta.cacheWriteTokens ?? 0;

      const meta = {
        tier: "ai",
        provider: response.meta.provider,
        model: response.meta.model,
        promptVersion: response.meta.promptVersion,
        rulesVersion: RULES_VERSION,
        memoryVersion,
        inputHash: response.meta.inputHash ?? null,
        inputTokens: response.meta.inputTokens ?? null,
        outputTokens: response.meta.outputTokens ?? null,
        cacheReadTokens: response.meta.cacheReadTokens ?? null,
        cacheWriteTokens: response.meta.cacheWriteTokens ?? null,
      };

      if (response.failure) {
        stats.aiFailure = `${response.failure.kind}: ${response.failure.detail}`;
        for (const t of batch) {
          decisions.set(t.id, unknownDecision(unknown, `AI tier ${response.failure.kind} — routed to review`, "AI", { ...meta, decidedAt: stamp() }));
        }
        continue;
      }

      const byRef = new Map<string, ClassificationResult>(response.results.map((r) => [r.ref, r]));
      for (const t of batch) {
        const result = byRef.get(t.id);
        if (!result) {
          decisions.set(t.id, unknownDecision(unknown, "AI returned no result for this transaction", "AI", { ...meta, decidedAt: stamp() }));
          continue;
        }

        // The raw proposal is kept whatever the gate decides, so a rejected
        // suggestion can be reproduced when someone asks "why did it say that?".
        const proposal = {
          accountCode: result.accountCode,
          gstTreatment: result.gstTreatment,
          confidence: result.confidence,
          reason: result.reason,
          needsReview: result.needsReview,
        };
        const lineage = { ...meta, proposal, decidedAt: stamp() };

        // The validation gate. Every proposal, no exceptions.
        const account = result.accountCode === CODE_UNKNOWN ? null : byCode.get(result.accountCode);
        const treatmentOk =
          account !== null &&
          account !== undefined &&
          account.type !== "UNKNOWN" &&
          result.gstTreatment !== "UNALLOCATED" &&
          treatmentAllowedFor(account.type as Exclude<AccountType, "UNKNOWN">, result.gstTreatment);
        const confidentEnough = result.confidence >= config.confidenceFloor;
        const abstained = result.needsReview && result.accountCode === CODE_UNKNOWN;

        if (!account || !treatmentOk || !confidentEnough || abstained) {
          const why = !account
            ? result.accountCode === CODE_UNKNOWN
              ? result.reason || "AI abstained"
              : `AI proposed account ${result.accountCode}, which this client cannot post to`
            : !treatmentOk
              ? `AI proposed ${result.gstTreatment} on ${account.name}, which is not a valid pairing`
              : `AI confidence ${result.confidence.toFixed(2)} is below the floor`;
          decisions.set(t.id, unknownDecision(unknown, why, "AI", lineage));
          continue;
        }

        decisions.set(t.id, {
          accountId: account.id,
          accountType: account.type,
          gstTreatment: result.gstTreatment,
          source: "AI",
          confidence: result.confidence,
          reasoning: result.reason,
          needsReview: result.needsReview || result.confidence < config.autoConfidence,
          memoryRuleId: null,
          meta: lineage,
        });
      }
    }

    // A cold cache on every call means something volatile crept into the
    // stable prefix, and the firm is paying full price for the chart of
    // accounts on every batch. Only a signal from the second call on.
    if (stats.tokens.calls > 1 && stats.tokens.cacheRead === 0 && stats.tokens.input > 0) {
      stats.warnings.push("No prompt-cache hits across the run's AI calls — the chart of accounts is being resent in full each time");
    }
  }

  // GST engine and risk, then persist. Deterministic; the AI never touched a figure.
  const touchedRules: string[] = [];
  await db.$transaction(
    async (tx) => {
      for (const t of transactions) {
        const d = decisions.get(t.id);
        if (!d) continue;
        const gstCents =
          client.gstRegistered && d.gstTreatment !== "UNALLOCATED"
            ? gstFromGross(t.amountCents, d.gstTreatment)
            : 0;
        // Novelty: nobody has reviewed this merchant. Inconsistency: someone
        // has, and coded it somewhere else than this decision proposes.
        const reviewedTo = codings.get(t.normalised);
        const risk = scoreRisk(
          {
            amountCents: t.amountCents,
            novel: reviewedTo === undefined,
            inconsistent: reviewedTo !== undefined && reviewedTo.size > 0 && !reviewedTo.has(d.accountId) && d.gstTreatment !== "UNALLOCATED",
            gstTreatment: d.gstTreatment,
            accountType: d.accountType,
          },
          config,
        );
        const needsReview = d.needsReview || risk === "HIGH";

        await repo.updateTransaction(tx, t.id, {
          status: "CLASSIFIED",
          accountId: d.accountId,
          gstTreatment: d.gstTreatment,
          gstCents,
          netCents: t.amountCents - gstCents,
          source: d.source,
          confidence: d.confidence,
          reasoning: d.reasoning,
          needsReview,
          risk,
          aiMeta: d.meta,
          memoryRuleId: d.memoryRuleId,
        });
        if (d.memoryRuleId) touchedRules.push(d.memoryRuleId);

        stats.processed += 1;
        if (d.source === "MEMORY") stats.byMemory += 1;
        else if (d.source === "RULE") stats.byRule += 1;
        else stats.byAi += 1;
        if (d.gstTreatment === "UNALLOCATED") stats.unknown += 1;
        if (needsReview) stats.needsReview += 1;
        else stats.autoCoded += 1;
      }

      stats.preAiRatio = stats.processed > 0 ? (stats.byMemory + stats.byRule) / stats.processed : 0;
      // The skill's target: rules and memory resolve most of the file before
      // any AI call. Below it on a run of any size, the fix is more rules.
      if (stats.processed >= 20 && stats.preAiRatio < config.preAiTarget) {
        stats.warnings.push(
          `Rules and memory resolved ${Math.round(stats.preAiRatio * 100)}% before the AI tier; the target is ${Math.round(config.preAiTarget * 100)}%`,
        );
      }

      await repo.touchMemoryRules(tx, [...new Set(touchedRules)]);
      await recordAudit(tx, {
        firmId,
        userId,
        clientId: client.id,
        action: "RECONCILIATION_RUN",
        entityType: "Client",
        entityId: client.id,
        after: { ...stats, rulesVersion: RULES_VERSION, memoryVersion, subset: ids ? ids.length : null },
      });
    },
    { timeout: 120_000 },
  );

  for (const warning of stats.warnings) console.warn(`[reconcile] ${client.id}: ${warning}`);

  return stats;
}
