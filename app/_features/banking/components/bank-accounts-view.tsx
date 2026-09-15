"use client";

/**
 * A client's bank accounts.
 *
 * There is no delete. An account carries the statements imported into it and
 * the transactions posted from them; removing one would orphan accounting
 * history. An account that is no longer used simply stops receiving imports.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createBankAccount,
  updateBankAccount,
} from "@/server/modules/banking/actions";
import { BANK_KIND_LABELS, feedProductLabel } from "@/shared/labels";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  Modal,
  ModalFooter,
  Select,
  cx,
} from "@/ui/primitives";
import { UploadStatementModal } from "./upload-statement-modal";
import { BankFeedCard, FeedRequestModal } from "./bank-feed-card";
import type {
  BankAccountRow,
  FeedConnectionRow,
  FeedInstitutionOption,
  FeedRequestRow,
  FeedSyncRunRow,
  LiveBalances,
} from "@/shared/contracts/bank-account";
import { Money, submitWith } from "@/ui/primitives";
import { EmptyHero, HeroAction } from "@/ui/empty-hero";

type Editing = { mode: "new" } | { mode: "edit"; account: BankAccountRow } | null;

export function BankAccountsView({
  clientId,
  clientName,
  accounts,
  feedRequests,
  feedConnections,
  feedInstitutions,
  feedSyncRuns,
  liveBalances,
  liveBalanceError,
  providerConfigured,
  providerName,
  deliveryIsAutomatic,
  justConnected,
  openUpload,
  openFeed = false,
}: {
  clientId: string;
  clientName: string;
  accounts: BankAccountRow[];
  feedRequests: FeedRequestRow[];
  feedConnections: FeedConnectionRow[];
  feedInstitutions: FeedInstitutionOption[];
  feedSyncRuns: FeedSyncRunRow[];
  /** Read live on this request. Never stored — see the contract. */
  liveBalances: LiveBalances;
  liveBalanceError: string | null;
  providerConfigured: boolean;
  providerName: string;
  /** False when no webhook is registered: data only moves on Sync now. */
  deliveryIsAutomatic: boolean;
  justConnected: boolean;
  openUpload: boolean;
  /** Arrived with ?feed=1: open the feed request straight away. */
  openFeed?: boolean | undefined;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<Editing>(null);
  const [upload, setUpload] = useState<{ bankAccountId?: string } | null>(openUpload ? {} : null);

  // The feed card earns its place once there is an account, a request or a
  // connection to show; before that the hero offers the feed on its own.
  const showFeedCard = accounts.length > 0 || feedRequests.length > 0 || feedConnections.length > 0;
  const [feedRequest, setFeedRequest] = useState(openFeed && !showFeedCard);

  function closeUpload() {
    setUpload(null);
    if (openUpload) router.replace(`/clients/${clientId}/banks`);
  }

  // The column only appears once a feed can actually produce a figure, so a
  // client on uploads alone never sees a row of empty dashes.
  const hasLiveBalances = Object.keys(liveBalances).length > 0;

  return (
    <div className="flex flex-col gap-5">
      {/* With no account yet the hero below carries the ways in; the toolbar would only repeat them. */}
      {accounts.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[15px] text-ink-2">
            Statements import into an account, and its transactions become this
            client&rsquo;s ledger.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" icon="plus" onClick={() => setEditing({ mode: "new" })}>
              Add bank account
            </Button>
            <Button icon="upload" onClick={() => setUpload({})}>
              Upload statement
            </Button>
          </div>
        </div>
      ) : null}

      {liveBalanceError ? (
        <Alert tone="warning" title="Live balances unavailable">
          {liveBalanceError} Stored transactions and reports are unaffected.
        </Alert>
      ) : null}

      {accounts.length === 0 ? (
        <EmptyHero
          title="No bank accounts yet"
          body="Connect a live feed and the accounts arrive on their own, or add the account the client banks through and upload a statement into it. Every transaction traces back to the account it came from."
          className="min-h-0 py-12"
          note={{
            title: "Only the last few digits of an account number are stored",
            body: "Never the full number, and never the client\u2019s banking credentials. A live feed runs through the Consumer Data Right: the client consents with their bank, the consent is time limited, and they can withdraw it at any time.",
          }}
        >
          <div className="grid w-full gap-3 sm:grid-cols-2">
            <HeroAction
              primary
              icon="link"
              title="Connect Live Bank Feed"
              body={providerConfigured ? "Send the client a secure request, or start the consent together" : "Send the client a secure request to approve with their bank"}
              onClick={() => (showFeedCard ? window.dispatchEvent(new Event("ledgerly:open-feed-request")) : setFeedRequest(true))}
            />
            <HeroAction
              icon="plus"
              title="Add Bank Account"
              body="Then upload a CSV or a bank statement PDF into it"
              onClick={() => setEditing({ mode: "new" })}
            />
          </div>
        </EmptyHero>
      ) : (
        <Card>
          <CardHeader
            title="Accounts"
            description="One account is the Cash at Bank account on the balance sheet."
          />
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Account</th>
                  <th className="w-40">Type</th>
                  <th className="w-32">Source</th>
                  {hasLiveBalances ? <th className="w-36 text-right">Balance now</th> : null}
                  <th className="w-32 text-right">Transactions</th>
                  <th className="w-28 text-right">Imports</th>
                  <th className="w-48" />
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => (
                  <tr key={account.id}>
                    <td>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{account.name}</span>
                        {account.accountMask ? (
                          <span className="code text-ink-3">
                            &bull;&bull;&bull;&bull;{account.accountMask}
                          </span>
                        ) : null}
                        {account.isCashAtBank ? (
                          <Badge tone="accent">Cash at bank</Badge>
                        ) : null}
                      </div>
                    </td>
                    <td className="text-ink-2">
                      {/* The provider's own product category when there is one:
                          "Mortgage" is a materially different thing from the
                          "Bank account" that our coarse kind would show. */}
                      {feedProductLabel(account.feedProductCategory) ?? BANK_KIND_LABELS[account.kind]}
                    </td>
                    <td className="text-ink-2">
                      {account.source === "FEED" ? "Live feed" : "Manual import"}
                    </td>
                    {hasLiveBalances ? (
                      <td className="figure text-right">
                        {liveBalances[account.id] === undefined || liveBalances[account.id] === null ? (
                          <span className="text-ink-3">—</span>
                        ) : (
                          <Money cents={liveBalances[account.id]!} />
                        )}
                      </td>
                    ) : null}
                    <td className="figure text-right text-ink-2">
                      {account.transactionCount.toLocaleString("en-AU")}
                    </td>
                    <td className="figure text-right text-ink-2">
                      {account.importCount.toLocaleString("en-AU")}
                    </td>
                    <td className="text-right">
                      <span className="inline-flex items-center gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          icon="upload"
                          onClick={() => setUpload({ bankAccountId: account.id })}
                        >
                          Upload
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          icon="pen"
                          onClick={() => setEditing({ mode: "edit", account })}
                        >
                          Edit
                        </Button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {showFeedCard ? (
        <BankFeedCard
          clientId={clientId}
          requests={feedRequests}
          connections={feedConnections}
          institutions={feedInstitutions}
          syncRuns={feedSyncRuns}
          providerConfigured={providerConfigured}
          providerName={providerName}
          deliveryIsAutomatic={deliveryIsAutomatic}
          justConnected={justConnected}
          openRequest={openFeed}
        />
      ) : null}

      {feedRequest ? <FeedRequestModal clientId={clientId} onClose={() => setFeedRequest(false)} /> : null}

      {accounts.length > 0 ? (
        <p className="text-xs leading-relaxed text-ink-3">
          Only the last few digits of an account number are stored — never the full
          number, and never the client&rsquo;s banking credentials.
          {hasLiveBalances
            ? " Balances are read from the bank each time this page loads and are never stored, so they are current rather than as at the last sync."
            : ""}
        </p>
      ) : null}

      {/* Mounted per target, and keyed by it: the modal's own state — the Cash
          at Bank switch — then starts from the row that opened it. */}
      {editing ? (
        <BankAccountModal
          key={editing.mode === "edit" ? editing.account.id : "new"}
          clientId={clientId}
          editing={editing}
          onClose={() => setEditing(null)}
        />
      ) : null}

      {upload ? (
        <UploadStatementModal
          targets={[{ clientId, clientName, bankAccounts: accounts.map((a) => ({ id: a.id, name: a.name })) }]}
          initialClientId={clientId}
          initialBankAccountId={upload.bankAccountId}
          onClose={closeUpload}
        />
      ) : null}
    </div>
  );
}

function BankAccountModal({
  clientId,
  editing,
  onClose,
}: {
  clientId: string;
  editing: NonNullable<Editing>;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [field, setField] = useState<string | null>(null);

  const account = editing.mode === "edit" ? editing.account : null;
  const [cashAtBank, setCashAtBank] = useState<boolean>(account?.isCashAtBank ?? false);

  function handleSubmit(formData: FormData) {
    setError(null);
    setField(null);
    formData.set("isCashAtBank", cashAtBank ? "yes" : "no");
    startTransition(async () => {
      const result = account
        ? await updateBankAccount(account.id, formData)
        : await createBankAccount(clientId, formData);
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
  const lockedCashAtBank = account?.isCashAtBank === true;

  return (
    <Modal
      open
      onClose={onClose}
      title={account ? "Edit bank account" : "Add bank account"}
      description={
        account
          ? "Renaming an account leaves its transactions and imports untouched."
          : "The account the client banks through. Statements import into it."
      }
    >
      <form onSubmit={submitWith(handleSubmit)}>
        <div className="flex flex-col gap-5 px-5 py-5">
          {error && !field ? <Alert tone="negative">{error}</Alert> : null}

          <Field
            label="Account name"
            name="name"
            required
            defaultValue={account?.name ?? ""}
            placeholder="e.g. Business Transaction Account"
            error={errorFor("name")}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Type" name="kind" defaultValue={account?.kind ?? "BANK"}>
              <option value="BANK">Bank account</option>
              <option value="CREDIT_CARD">Credit card</option>
            </Select>
            <Field
              label="Last digits"
              name="accountMask"
              inputMode="numeric"
              defaultValue={account?.accountMask ?? ""}
              placeholder="e.g. 4821"
              hint="Three or four digits, to tell accounts apart."
              error={errorFor("accountMask")}
            />
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={cashAtBank || lockedCashAtBank}
            disabled={lockedCashAtBank}
            onClick={() => setCashAtBank((on) => !on)}
            className={cx(
              "flex items-start gap-3 rounded-control border px-3.5 py-3 text-left transition-colors",
              cashAtBank || lockedCashAtBank
                ? "border-accent bg-accent-soft"
                : "border-rule bg-surface hover:border-rule-strong",
              lockedCashAtBank && "cursor-default opacity-80",
            )}
          >
            <span
              className={cx(
                "mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-[5px] border",
                cashAtBank || lockedCashAtBank
                  ? "border-accent bg-accent text-white"
                  : "border-rule-strong bg-surface",
              )}
            >
              {cashAtBank || lockedCashAtBank ? (
                <svg viewBox="0 0 12 12" className="size-3" aria-hidden="true">
                  <path
                    d="M2.5 6.2l2.2 2.2 4.8-5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : null}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-ink">
                Use as Cash at Bank
              </span>
              <span className="mt-0.5 block text-xs leading-relaxed text-ink-2">
                {lockedCashAtBank
                  ? "This is the Cash at Bank account. Promote another account to move it."
                  : "The balance sheet has one Cash at Bank line. Choosing this account demotes the current one."}
              </span>
            </span>
          </button>
        </div>

        <ModalFooter>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : account ? "Save changes" : "Add account"}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
