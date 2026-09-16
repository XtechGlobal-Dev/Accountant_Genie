"use client";

/**
 * AI-proposed subcontractor links. The model reads the unlinked payments on
 * the TPAR accounts and proposes who was paid; a person confirms each one.
 * Nothing is linked or created until they do — the proposal is a proposal.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { confirmSubcontractorLink, proposeSubcontractors } from "@/server/modules/subcontractors/actions";
import type { SubcontractorProposal, SubcontractorProposals } from "@/shared/contracts/register";
import { shortDate } from "@/shared/format";
import { Alert, Badge, Button, Card, CardHeader, Money } from "@/ui/primitives";

export function SubcontractorProposalsPanel({ clientId, canManage }: { clientId: string; canManage: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<SubcontractorProposals | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());

  if (!canManage) return null;

  function find() {
    setError(null);
    startTransition(async () => {
      const proposals = await proposeSubcontractors(clientId);
      if (!proposals) setError("Could not read this client's payments");
      setResult(proposals);
    });
  }

  async function confirm(p: SubcontractorProposal) {
    const choice = p.knownId ? { knownId: p.knownId } : p.proposedName ? { newName: p.proposedName } : null;
    if (!choice) return;
    setBusy(p.transactionId);
    setError(null);
    const outcome = await confirmSubcontractorLink(clientId, p.transactionId, choice);
    if (outcome.ok) setDone((s) => new Set(s).add(p.transactionId));
    else setError(outcome.error);
    setBusy(null);
    startTransition(() => router.refresh());
  }

  return (
    <Card>
      <CardHeader
        title="Find subcontractor payments"
        description="Payments on the subcontractor account with nobody linked. The model proposes who was paid; you confirm. Nothing reaches the TPAR until you do."
        action={
          <Button variant="secondary" size="sm" icon="search" onClick={find} disabled={pending}>
            {pending ? "Reading payments…" : result ? "Run again" : "Find payments"}
          </Button>
        }
      />
      {error ? (
        <div className="px-5 pb-4">
          <Alert tone="negative">{error}</Alert>
        </div>
      ) : null}
      {result?.failure ? (
        <div className="px-5 pb-4">
          <Alert tone="warning" title="The model could not propose anything">
            {result.failure}. Link the payments by hand on the Transactions screen.
          </Alert>
        </div>
      ) : null}
      {result && result.proposals.length === 0 && !result.failure ? (
        <p className="px-5 pb-5 text-sm text-ink-2">Every subcontractor payment is already linked.</p>
      ) : null}
      {result && result.proposals.length > 0 ? (
        <table>
          <thead>
            <tr>
              <th className="w-28">Date</th>
              <th>Payment</th>
              <th className="w-32 text-right">Amount</th>
              <th>Proposal</th>
              <th className="w-36 text-right">
                <span className="sr-only">Confirm</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {result.proposals.map((p) => {
              const linked = done.has(p.transactionId);
              const proposal = p.knownId ? `Link to ${p.knownName}` : p.proposedName ? `Add “${p.proposedName}” and link` : null;
              return (
                <tr key={p.transactionId} className={linked ? "opacity-60" : undefined}>
                  <td className="figure text-ink-2">{shortDate(p.date)}</td>
                  <td className="max-w-[20rem] truncate" title={p.description}>
                    {p.description}
                  </td>
                  <td className="text-right">
                    <Money cents={p.amountCents} />
                  </td>
                  <td>
                    {proposal ? (
                      <span className="flex flex-wrap items-center gap-2">
                        <span>{proposal}</span>
                        <Badge tone={p.confidence >= 0.8 ? "positive" : "warning"} title={p.reason}>
                          {Math.round(p.confidence * 100)}%
                        </Badge>
                      </span>
                    ) : (
                      <span className="text-ink-3" title={p.reason}>
                        No proposal — abstained
                      </span>
                    )}
                  </td>
                  <td className="text-right">
                    {linked ? (
                      <Badge tone="positive">Linked</Badge>
                    ) : proposal ? (
                      <Button size="sm" variant="soft" disabled={busy === p.transactionId} onClick={() => confirm(p)}>
                        Confirm
                      </Button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}
      {result ? (
        <p className="px-5 py-3 text-xs text-ink-3">
          Proposed by {result.provider ?? "no provider"} · prompt {result.promptVersion ?? "—"}. A confirmed link is a recode of the payment
          and is audited like one.
        </p>
      ) : null}
    </Card>
  );
}
