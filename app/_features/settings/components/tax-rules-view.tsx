"use client";

/**
 * Tax rules and their verification.
 *
 * Every figure the software would otherwise have to assume is listed here
 * with its status. A pending value is shown but not applied; a verified one
 * names who signed it off and from when. Only a registered tax agent can
 * verify; anyone who manages the firm can propose.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { proposeTaxRule, verifyTaxRule } from "@/server/modules/tax-rules/actions";
import type { TaxRuleView, TaxRuleVersionView } from "@/shared/contracts/tax-rule";
import { money, shortDate } from "@/shared/format";
import { Alert, Badge, Button, Card, CardHeader, Field, Modal, ModalFooter, PageHeader } from "@/ui/primitives";

function valueOf(version: TaxRuleVersionView): string {
  if (version.valueCents !== null) return money(version.valueCents);
  return version.valueText ?? "—";
}

export function TaxRulesView({ rules, isTaxAgent, canPropose }: { rules: TaxRuleView[]; isTaxAgent: boolean; canPropose: boolean }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [proposing, setProposing] = useState<TaxRuleView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function verify(version: TaxRuleVersionView) {
    setBusy(version.id);
    setError(null);
    const result = await verifyTaxRule(version.id, new FormData());
    if (!result.ok) setError(result.error);
    startTransition(() => router.refresh());
    setBusy(null);
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Tax rules"
        context="Every rule the software depends on, versioned with effective dates. A value is applied only once a registered tax agent has verified it."
      />
      {!isTaxAgent ? (
        <Alert tone="info">
          Verification is reserved for a registered tax agent. {canPropose ? "You can propose a value for one to sign off." : ""}
        </Alert>
      ) : null}
      {error ? <Alert tone="negative">{error}</Alert> : null}

      {rules.map((rule) => (
        <Card key={rule.code}>
          <CardHeader
            title={
              <span className="flex flex-wrap items-center gap-2">
                {rule.label}
                {rule.current ? (
                  <Badge tone="positive">Verified · {valueOf(rule.current)}</Badge>
                ) : (
                  <Badge tone="warning">Not verified — not applied</Badge>
                )}
              </span>
            }
            description={rule.description}
            action={
              canPropose || isTaxAgent ? (
                <Button variant="secondary" size="sm" icon="plus" onClick={() => setProposing(rule)}>
                  Propose version
                </Button>
              ) : undefined
            }
          />
          {rule.versions.length === 0 ? (
            <p className="px-5 py-4 text-sm text-ink-3">No version proposed yet.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th className="w-40">Value</th>
                  <th className="w-32">From</th>
                  <th className="w-32">To</th>
                  <th className="w-40">Status</th>
                  <th>Note</th>
                  <th className="w-32 text-right">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rule.versions.map((version) => (
                  <tr key={version.id}>
                    <td className="figure font-medium">{valueOf(version)}</td>
                    <td className="figure text-ink-2">{shortDate(version.effectiveFrom)}</td>
                    <td className="figure text-ink-2">{version.effectiveTo ? shortDate(version.effectiveTo) : "open"}</td>
                    <td>
                      {version.status === "VERIFIED" ? (
                        <Badge tone="positive" title={version.verifiedAt ? `Verified ${shortDate(version.verifiedAt)}` : undefined}>
                          Verified{version.verifiedBy ? ` by ${version.verifiedBy}` : ""}
                        </Badge>
                      ) : version.status === "SUPERSEDED" ? (
                        <Badge tone="neutral">Superseded</Badge>
                      ) : (
                        <Badge tone="warning">Pending</Badge>
                      )}
                    </td>
                    <td className="text-ink-2">{version.note ?? "—"}</td>
                    <td className="text-right">
                      {version.status === "PENDING_VERIFICATION" && isTaxAgent ? (
                        <Button variant="soft" size="sm" icon="shield-check" disabled={busy === version.id} onClick={() => verify(version)}>
                          Verify
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      ))}

      {proposing ? <ProposeModal key={proposing.code} rule={proposing} onClose={() => setProposing(null)} /> : null}
    </div>
  );
}

function ProposeModal({ rule, onClose }: { rule: TaxRuleView; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [field, setField] = useState<string | null>(null);

  function submit(formData: FormData) {
    setError(null);
    setField(null);
    formData.set("code", rule.code);
    formData.set("kind", rule.kind);
    startTransition(async () => {
      const result = await proposeTaxRule(formData);
      if (result.ok) {
        onClose();
        router.refresh();
      } else {
        setError(result.error);
        setField(result.field ?? null);
      }
    });
  }
  const errorFor = (name: string) => (field === name ? (error ?? undefined) : undefined);

  return (
    <Modal open onClose={onClose} title={`Propose: ${rule.label}`} description="A new version, pending until a registered tax agent verifies it. Cite the source in the note.">
      <form action={submit}>
        <div className="flex flex-col gap-4 px-5 py-5">
          {error && !field ? <Alert tone="negative">{error}</Alert> : null}
          <Field
            label={rule.kind === "AMOUNT" ? "Amount (dollars)" : "Value"}
            name="value"
            required
            inputMode={rule.kind === "AMOUNT" ? "decimal" : undefined}
            defaultValue={rule.kind === "TEXT" ? (rule.versions[0]?.valueText ?? "") : ""}
            placeholder={rule.kind === "AMOUNT" ? "0.00" : ""}
            error={errorFor("value")}
          />
          <Field label="Effective from" name="effectiveFrom" required type="date" error={errorFor("effectiveFrom")} />
          <Field label="Note" name="note" placeholder="e.g. ATO ruling or legislation reference" error={errorFor("note")} />
        </div>
        <ModalFooter>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Propose"}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
