import "server-only";

import { db } from "@/server/core/db";
import { recordAudit } from "@/server/core/audit";
import { getAIProvider, type ClassificationResult, type ProposedAccount, type ReviewInputTx } from "@/server/ai";
import { gstFromGross } from "@/server/au/gst";
import { CODE_CASH_AT_BANK, CODE_CREDIT_CARD, CODE_UNKNOWN } from "@/server/au/coa";
import * as accounts from "@/server/modules/accounts/repository";
import { resolveProposedAccountInTx } from "@/server/modules/accounts/service";
import * as clients from "@/server/modules/clients/repository";
import { buildBankJournal } from "@/server/modules/ledger/journal-engine";
import { treatmentAllowedFor } from "@/shared/account-rules";
import type { AccountType, ClassificationSource, GstTreatment } from "@/shared/enums";
import type { ReconcileStats } from "@/shared/contracts/transaction";
import { findSimilarAccount, type ResolvableAccount } from "@/server/modules/accounts/resolver";
import { RULES_VERSION, reconcileConfig, type ReconcileConfig } from "./config";
import { matchMemory, type MemoryCandidate } from "./memory";
import * as repo from "./repository";
import { judgeReview, reviewerNote, reviewerReviewReason, type ReviewerJudgement } from "./reviewer";
import { RISK_FACTOR_REASONS, riskFactor, scoreRisk, type RiskInput, type RiskLevel } from "./risk";
import { applyRules, RULES } from "./rules";

/**
 * The reconciliation pipeline, in the order the skill prescribes:
 *
 *   coding memory → deterministic rules → candidate accounts → AI (only what
 *   survives) → validation gate → AI reviewer → GST engine → risk → route
 *
 * The reviewer is a second AI call with its own prompt and the client's
 * signed-off history, over every coding the classifier proposed. Its
 * confident AGREE stands in for the first look a person would otherwise
 * give a row — see reviewer.ts for exactly which reasons it may clear and
 * which it never can. Its DISAGREE or ESCALATE sends a row to a person even
 * when the classifier was sure.
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
  /** Set when this decision codes to an account created from an AI proposal in this run. */
  createdAccount?: { code: number; name: string };
  /** Why the tier that made this decision asked for a person, when it did. */
  reviewNote?: string;
  /** A reason for review that no reviewer verdict clears: a person decides. */
  hardReview?: string;
}

/** An AI proposal for a new account, held until the persist transaction can resolve it. */
interface PendingProposal {
  proposal: ProposedAccount;
  result: ClassificationResult;
  lineage: Decision["meta"];
  provider: string;
  model: string;
  promptVersion: string;
}

/**
 * One line for the upload dialog on why a row needs a look — the class of
 * reason, not the row's own reasoning, so five rows with five different
 * narrations still count under one heading.
 */
function reviewReasonFor(
  d: Decision,
  riskInput: RiskInput,
  risk: RiskLevel,
  config: ReconcileConfig,
  judgement: ReviewerJudgement | undefined,
): string {
  if (d.gstTreatment === "UNALLOCATED") {
    return d.meta.tier === "ai" && typeof d.meta.provider === "string" && d.reasoning.startsWith("AI tier")
      ? "The AI tier did not answer"
      : "No suitable account found";
  }
  const cleared = judgement?.cleared === true;
  // A reviewer that disagrees is the headline: the person sees two codings.
  if (judgement?.verdict === "DISAGREE") return reviewerReviewReason(judgement)!;
  if (!cleared) {
    if (d.createdAccount) return "Coded to a new account — confirm it";
    // The tier that coded it asked for a person and said why (an ATO payment,
    // a loan split, a rent treatment): that is the actionable reason, ahead of
    // a risk factor the same row may also trip — and ahead of the reviewer
    // concurring, which adds nothing to what the person has to decide.
    if (d.reviewNote) return d.reviewNote;
    if (judgement) {
      const why = reviewerReviewReason(judgement);
      if (why) return why;
    }
  }
  if (d.hardReview) return d.hardReview;
  if (risk === "HIGH") {
    const factor = riskFactor(riskInput, config);
    if (factor) return RISK_FACTOR_REASONS[factor];
  }
  if (!cleared && d.source === "AI" && d.confidence < config.autoConfidence) return "AI confidence below the auto-accept threshold";
  return d.reasoning;
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
  const [transactions, visible, memoryRows, codings, historyRows] = await Promise.all([
    repo.listForEngine(firmId, client.id, ids),
    accounts.listPostableAccounts(firmId, client.id),
    repo.listMemoryForClient(firmId, client.id),
    repo.reviewedCodings(firmId, client.id),
    config.reviewerEnabled ? repo.recentReviewedHistory(firmId, client.id) : Promise.resolve([]),
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
    accountsCreated: [],
    reviewReasons: [],
    reviewer: { checked: 0, agreed: 0, disagreed: 0, escalated: 0, cleared: 0, failure: null },
  };
  if (transactions.length === 0) return stats;

  // The Unknown sentinel is not "postable", so it is looked up separately.
  // The bank-side accounts are what the dry-run journal posts against.
  const [unknownRow, cashRow, cardRow] = await Promise.all([
    repo.findSystemAccountByCode(CODE_UNKNOWN),
    repo.findSystemAccountByCode(CODE_CASH_AT_BANK),
    repo.findSystemAccountByCode(CODE_CREDIT_CARD),
  ]);
  if (!unknownRow) throw new Error("System account 0 (Unknown) is missing — run the seed");
  if (!cashRow || !cardRow) throw new Error("Bank ledger accounts are missing — run the seed");
  const bankLedgerIdFor = (kind: string) => (kind === "CREDIT_CARD" ? cardRow.id : cashRow.id);
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
  const proposals = new Map<string, PendingProposal>();
  /** Every AI result that passed the gate, so the reviewer can be shown what was proposed. */
  const aiResults = new Map<string, ClassificationResult>();
  /** The reviewer's verdict per transaction, applied at routing. */
  const judgements = new Map<string, ReviewerJudgement>();
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
          reviewNote: rule.needsReview ? rule.reason : undefined,
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
          vendor: result.vendor,
          category: result.category,
          // Flattened: lineage is one level of JSON deep by type, so it stays
          // greppable and never grows into a document.
          proposedAccountName: result.proposedAccount?.name ?? null,
          proposedAccountType: result.proposedAccount?.type ?? null,
          proposedAccountTreatment: result.proposedAccount?.gstTreatment ?? null,
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

        // Unknown plus a proposal is not an abstention: the model found the
        // nature of the supply and no account to hold it. The account is
        // resolved — reused or created — inside the persist transaction, so
        // it exists only if the decisions that depend on it are written.
        if (!account && result.proposedAccount && confidentEnough) {
          aiResults.set(t.id, result);
          proposals.set(t.id, {
            proposal: result.proposedAccount,
            result,
            lineage,
            provider: response.meta.provider,
            model: response.meta.model,
            promptVersion: response.meta.promptVersion,
          });
          decisions.set(t.id, unknownDecision(unknown, `AI proposed a new account "${result.proposedAccount.name}" — not yet resolved`, "AI", lineage));
          continue;
        }

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

        aiResults.set(t.id, result);
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
          reviewNote: result.needsReview ? result.reason : undefined,
        });
      }
    }

    // The reviewer tier. Every coding that passed the gate — the confident
    // ones included, since a confident mistake is what a second look is for
    // — goes back with what the classifier never saw: the client's signed-off
    // history. A proposed account is reviewed as a proposal, before it exists.
    // A refusal or a failure leaves the rows exactly as the classifier routed
    // them; the reviewer can only ever add a look, never remove the gate.
    if (config.reviewerEnabled && aiResults.size > 0) {
      const toReview: ReviewInputTx[] = [];
      for (const t of forAi) {
        const result = aiResults.get(t.id);
        const d = decisions.get(t.id);
        if (!result || !d) continue;
        const pending = proposals.get(t.id);
        const account = pending ? null : byId.get(d.accountId);
        if (!pending && (!account || d.gstTreatment === "UNALLOCATED")) continue;
        toReview.push({
          ref: t.id,
          description: t.description,
          amountCents: t.amountCents,
          date: t.date.toISOString().slice(0, 10),
          proposal: {
            accountCode: pending ? CODE_UNKNOWN : account!.code,
            accountName: pending ? pending.proposal.name : account!.name,
            gstTreatment: pending ? pending.proposal.gstTreatment : d.gstTreatment,
            confidence: result.confidence,
            reason: result.reason,
            vendor: result.vendor,
            category: result.category,
          },
          proposedAccount: pending ? pending.proposal : null,
          classifierConcern: result.needsReview ? result.reason : null,
          firstSeen: codings.get(t.normalised) === undefined,
          feedCategory: t.feedCategory,
          feedSubcategory: t.feedSubcategory,
          merchantCode: t.feedMerchantCode,
        });
      }
      const history = historyRows.flatMap((h) =>
        h.account && h.gstTreatment
          ? [{ date: h.date.toISOString().slice(0, 10), description: h.description, amountCents: h.amountCents, accountCode: h.account.code, gstTreatment: h.gstTreatment }]
          : [],
      );

      for (let i = 0; i < toReview.length; i += config.batchSize) {
        const batch = toReview.slice(i, i + config.batchSize);
        const response = await provider.reviewClassifications({
          transactions: batch,
          client: { industry: client.industry, entityType: client.entityType, gstRegistered: client.gstRegistered },
          accounts: chart,
          memory: hints,
          history,
        });

        stats.tokens.calls += 1;
        stats.tokens.input += response.meta.inputTokens ?? 0;
        stats.tokens.output += response.meta.outputTokens ?? 0;
        stats.tokens.cacheRead += response.meta.cacheReadTokens ?? 0;
        stats.tokens.cacheWrite += response.meta.cacheWriteTokens ?? 0;

        if (response.failure) {
          stats.reviewer.failure = `${response.failure.kind}: ${response.failure.detail}`;
          continue;
        }

        const byRef = new Map(response.results.map((r) => [r.ref, r]));
        for (const item of batch) {
          const result = byRef.get(item.ref);
          const d = decisions.get(item.ref);
          if (!result || !d) continue;
          const judgement = judgeReview(result, config.reviewerConfidence);
          judgements.set(item.ref, judgement);
          stats.reviewer.checked += 1;
          if (judgement.verdict === "AGREE") stats.reviewer.agreed += 1;
          else if (judgement.verdict === "DISAGREE") stats.reviewer.disagreed += 1;
          else stats.reviewer.escalated += 1;
          // Lineage, on the same object a pending proposal shares, so the
          // decision built for it inside the transaction carries this too.
          d.meta.reviewer = {
            provider: response.meta.provider,
            model: response.meta.model,
            promptVersion: response.meta.promptVersion,
            inputHash: response.meta.inputHash ?? null,
            verdict: judgement.verdict,
            confidence: judgement.confidence,
            reason: judgement.reason,
            suggestedAccountCode: judgement.suggestedAccountCode,
            suggestedGstTreatment: judgement.suggestedGstTreatment,
            cleared: judgement.cleared,
            decidedAt: stamp(),
          };
        }
      }
    }

    // A cold cache on every call means something volatile crept into the
    // stable prefix, and the firm is paying full price for the chart of
    // accounts on every batch. Only a signal from the second call on.
    if (stats.tokens.calls > 1 && stats.tokens.cacheRead === 0 && stats.tokens.input > 0) {
      stats.warnings.push("No prompt-cache hits across the run's AI calls — the chart of accounts is being resent in full each time");
    }
  }

  // Account resolution, GST engine, journal dry run and risk, then persist.
  // Deterministic; the AI never touched a figure, a code or a debit.
  const touchedRules: string[] = [];
  const reviewReasons = new Map<string, number>();
  const byTxId = new Map(transactions.map((t) => [t.id, t]));
  await db.$transaction(
    async (tx) => {
      // Proposed accounts first: reuse what the chart has, create what it
      // lacks, up to the run's cap. An account created here joins the chart
      // the resolver searches, so a second proposal for the same kind of
      // expense in the same file reuses the first instead of duplicating it.
      const chart: ResolvableAccount[] = [...visible];
      const createdInRun = new Set<string>();
      for (const [txId, pending] of proposals) {
        const t = byTxId.get(txId);
        if (!t) continue;
        const name = pending.proposal.name;
        if (stats.accountsCreated.length >= config.maxNewAccountsPerRun && !findSimilarAccount(chart, pending.proposal)) {
          decisions.set(
            txId,
            unknownDecision(unknown, `AI proposed a new account "${name}" — this run already created ${config.maxNewAccountsPerRun}; create it by hand or recode`, "AI", pending.lineage),
          );
          continue;
        }
        const outcome = await resolveProposedAccountInTx(tx, firmId, userId, pending.proposal, chart, {
          bankTransactionId: txId,
          provider: pending.provider,
          model: pending.model,
          promptVersion: pending.promptVersion,
          reason: pending.result.reason,
          confidence: pending.result.confidence,
        });
        if (!outcome.ok) {
          decisions.set(txId, unknownDecision(unknown, `AI proposed a new account "${name}" but it was refused: ${outcome.error}`, "AI", pending.lineage));
          continue;
        }
        const account = { ...outcome.account, description: outcome.account.description ?? null };
        if (outcome.created) {
          chart.push(account);
          byId.set(account.id, account);
          byCode.set(account.code, account);
          createdInRun.add(account.id);
          stats.accountsCreated.push({ code: account.code, name: account.name });
        }
        // An account nobody has confirmed yet: every row coded to it in this
        // run waits for a person, not only the one that created it.
        const unconfirmed = createdInRun.has(account.id);
        // The chart is the authority on an account's default treatment. A
        // proposal that disagrees with the account it resolved to is kept as
        // evidence and shown to a person, never applied over the chart.
        const treatmentDiffers = !unconfirmed && pending.proposal.gstTreatment !== account.gstTreatment;
        const reasoning = outcome.created
          ? `Coded to new account ${account.code} ${account.name}, created from the AI's proposal`
          : unconfirmed
            ? `Coded to ${account.code} ${account.name}, created earlier in this import`
            : `AI proposed "${name}"; the chart already has ${account.code} ${account.name}` +
              (treatmentDiffers ? `, whose default treatment differs from the proposed ${pending.proposal.gstTreatment}` : "");
        decisions.set(txId, {
          accountId: account.id,
          accountType: account.type,
          gstTreatment: account.gstTreatment,
          source: "AI",
          confidence: pending.result.confidence,
          reasoning,
          needsReview: unconfirmed || treatmentDiffers || pending.result.needsReview || pending.result.confidence < config.autoConfidence,
          memoryRuleId: null,
          meta: { ...pending.lineage, resolvedAccountCode: account.code, accountCreated: outcome.created, matchedScore: outcome.matchedScore },
          createdAccount: unconfirmed ? { code: account.code, name: account.name } : undefined,
          reviewNote: pending.result.needsReview ? pending.result.reason : undefined,
          // The reviewer judged the proposal, not the account the resolver
          // matched it to. A default treatment that differs is a person's call.
          hardReview: treatmentDiffers ? "The proposed tax treatment differs from the account's default" : undefined,
        });
      }

      for (const t of transactions) {
        const d = decisions.get(t.id);
        if (!d) continue;
        const gstCents =
          client.gstRegistered && d.gstTreatment !== "UNALLOCATED"
            ? gstFromGross(t.amountCents, d.gstTreatment)
            : 0;
        // Novelty: nobody has reviewed this merchant, and the AI — not a
        // rule or a memory the firm itself wrote — is the one proposing.
        // Inconsistency: someone has reviewed it, and coded it somewhere
        // else than this decision proposes.
        const reviewedTo = codings.get(t.normalised);
        const judgement = d.source === "AI" && d.gstTreatment !== "UNALLOCATED" ? judgements.get(t.id) : undefined;
        const cleared = judgement?.cleared === true;
        const riskInput = {
          amountCents: t.amountCents,
          // A confident reviewer AGREE is the first look at a new merchant
          // that novelty was waiting for; the other factors it cannot clear.
          novel: d.source === "AI" && reviewedTo === undefined && !cleared,
          inconsistent: reviewedTo !== undefined && reviewedTo.size > 0 && !reviewedTo.has(d.accountId) && d.gstTreatment !== "UNALLOCATED",
          gstTreatment: d.gstTreatment,
          accountType: d.accountType,
        };
        const risk = scoreRisk(riskInput, config);
        // What the row would have done on the classifier alone, so the run
        // can say how many rows the reviewer actually moved to Ready.
        const wouldHaveWaited = d.needsReview || scoreRisk({ ...riskInput, novel: d.source === "AI" && reviewedTo === undefined }, config) === "HIGH";
        let needsReview = cleared ? Boolean(d.hardReview) || risk === "HIGH" : d.needsReview || risk === "HIGH";
        // Anything short of a confident AGREE is a person's row, whatever the classifier thought.
        if (judgement && !cleared) needsReview = true;
        let reasoning = d.reasoning;
        if (judgement) {
          const suggested = judgement.suggestedAccountCode !== null ? byCode.get(judgement.suggestedAccountCode) : undefined;
          reasoning = `${reasoning} · ${reviewerNote(judgement, suggested ? { code: suggested.code, name: suggested.name } : null, config.reviewerConfidence)}`;
        }

        // The journal dry run. A coding is only "Ready" if the entry it
        // would post balances and passes every check posting applies — the
        // same engine, the same lines, nothing written.
        if (d.gstTreatment !== "UNALLOCATED") {
          const journal = buildBankJournal({
            amountCents: t.amountCents,
            gstRegistered: client.gstRegistered,
            bankLedgerAccountId: bankLedgerIdFor(t.bankAccount.kind),
            allocations: [{ accountId: d.accountId, cents: Math.abs(t.amountCents), gstTreatment: d.gstTreatment }],
            bankTransactionId: t.id,
          });
          if (!journal.ok) {
            needsReview = true;
            reasoning = `${reasoning} — cannot post: ${journal.error}`;
          }
        }

        if (needsReview) {
          const why = reviewReasonFor(d, riskInput, risk, config, judgement);
          reviewReasons.set(why, (reviewReasons.get(why) ?? 0) + 1);
        } else if (cleared && wouldHaveWaited) {
          stats.reviewer.cleared += 1;
        }

        await repo.updateTransaction(tx, t.id, {
          status: "CLASSIFIED",
          accountId: d.accountId,
          gstTreatment: d.gstTreatment,
          gstCents,
          netCents: t.amountCents - gstCents,
          source: d.source,
          confidence: d.confidence,
          reasoning,
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

      stats.reviewReasons = [...reviewReasons.entries()]
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason))
        .slice(0, 6);

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
