"use client";

/**
 * Live bank feeds.
 *
 * Two halves, because they are two different things. A *request* asks the
 * client by email to authorise a feed — our own artefact, which works whether
 * or not a provider is configured. A *connection* is a CDR consent at Fiskil,
 * which the client grants at their own bank and can withdraw at any time.
 *
 * The consent itself is opened by the Fiskil Link SDK, in a window this page
 * controls. The browser is given only a short-lived auth session id; it never
 * sees a Fiskil credential, and the client's banking login goes to their bank,
 * never through here.
 *
 * CDR consents EXPIRE. That is the thing an accountant most needs warning
 * about, because a lapsed consent stops the data silently, so renewal is
 * surfaced on the row rather than buried in a status.
 */

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { link } from "@fiskil/link";
import {
  cancelFeedRequest,
  completeFeedConnection,
  refreshFeedConnections,
  requestBankFeed,
  revokeFeedConnection,
  startFeedConnection,
  syncFeed,
} from "@/server/modules/banking/actions";
import type {
  FeedConnectionRow,
  FeedInstitutionOption,
  FeedRequestRow,
  FeedSyncRunRow,
} from "@/shared/contracts/bank-account";
import type { MailOutcome } from "@/shared/contracts/result";
import { shortDate } from "@/shared/format";
import { Icon } from "@/ui/icons";
import { Alert, Badge, Button, Card, CardHeader, Field, Modal, ModalFooter, Select, submitWith } from "@/ui/primitives";

type Tone = "warning" | "positive" | "negative" | "neutral";

const REQUEST_STATUS: Record<FeedRequestRow["status"], { label: string; tone: Tone }> = {
  PENDING: { label: "Awaiting client", tone: "warning" },
  CONNECTED: { label: "Authorised", tone: "positive" },
  DECLINED: { label: "Declined", tone: "negative" },
  EXPIRED: { label: "Expired", tone: "neutral" },
};

const CONNECTION_STATUS: Record<FeedConnectionRow["status"], { label: string; tone: Tone }> = {
  PENDING: { label: "Awaiting consent", tone: "warning" },
  ACTIVE: { label: "Active", tone: "positive" },
  EXPIRED: { label: "Consent expired", tone: "warning" },
  REVOKED: { label: "Revoked", tone: "neutral" },
  ERROR: { label: "Needs attention", tone: "negative" },
};

/**
 * What the Link SDK's error codes mean, in words an accountant can act on.
 * A raw enum on screen tells the person sitting with their client nothing.
 */
const LINK_ERRORS: Record<string, string> = {
  LINK_USER_CANCELLED: "The client closed the consent window before finishing.",
  LINK_TIMEOUT: "The consent flow timed out. Start it again when the client is ready.",
  LINK_INVALID_SESSION: "That consent session is no longer valid. Start a new one.",
  LINK_NOT_FOUND: "The consent window could not be opened.",
  LINK_ORIGIN_MISMATCH: "A message arrived from an unexpected origin and was ignored.",
  LINK_INTERNAL_ERROR: "Fiskil reported an internal error during the consent flow.",
  AUTH_SESSION_CANCELLED: "The consent session was cancelled.",
  CONSENT_ENDUSER_DENIED: "The client declined to share their data.",
  CONSENT_OTP_FAILURE: "One-time password verification failed at the bank.",
  CONSENT_TIMEOUT: "The client abandoned the flow before completing it.",
  CONSENT_ENDUSER_INELIGIBLE: "This client is not eligible for data sharing at that institution.",
  CONSENT_UPSTREAM_PROCESSING_ERROR: "The bank returned an error during consent.",
};

function linkErrorMessage(error: unknown): string {
  const code = (error as { code?: string } | null)?.code;
  if (!code) return "The consent could not be completed.";
  return LINK_ERRORS[code] ?? `The consent could not be completed (${code}).`;
}

export function BankFeedCard({
  clientId,
  requests,
  connections,
  institutions,
  syncRuns,
  providerConfigured,
  providerName,
  deliveryIsAutomatic,
  justConnected,
  openRequest = false,
}: {
  clientId: string;
  requests: FeedRequestRow[];
  connections: FeedConnectionRow[];
  institutions: FeedInstitutionOption[];
  syncRuns: FeedSyncRunRow[];
  providerConfigured: boolean;
  providerName: string;
  /** False when no webhook is registered: data only moves on Sync now. */
  deliveryIsAutomatic: boolean;
  justConnected: boolean;
  openRequest?: boolean | undefined;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [modal, setModal] = useState<{ kind: "request" } | { kind: "connect"; renewId?: string } | null>(
    openRequest ? { kind: "request" } : null,
  );
  const [showRuns, setShowRuns] = useState(false);

  // The empty state above this card asks for a feed through a window event.
  useEffect(() => {
    function onOpen() {
      setModal({ kind: "request" });
    }
    window.addEventListener("ledgerly:open-feed-request", onOpen);
    return () => window.removeEventListener("ledgerly:open-feed-request", onOpen);
  }, []);

  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "positive" | "negative"; text: string } | null>(
    justConnected
      ? {
          tone: "positive",
          text: deliveryIsAutomatic
            ? "Consent completed at the bank. Transactions arrive on their own; use Sync now to pull immediately."
            : "Consent completed at the bank. Press Sync now to pull the transactions.",
        }
      : null,
  );

  async function run(id: string, work: () => Promise<{ ok: boolean; error?: string }>, done: string) {
    setBusy(id);
    const result = await work();
    setNotice(
      result.ok
        ? { tone: "positive", text: done }
        : { tone: "negative", text: result.error ?? "Something went wrong" },
    );
    startTransition(() => router.refresh());
    setBusy(null);
  }

  const renewals = connections.filter((connection) => connection.needsRenewal);

  return (
    <Card>
      <CardHeader
        title="Live bank feed"
        description={
          deliveryIsAutomatic
            ? "Transactions arrive on their own once the client authorises a feed with their bank."
            : "The client authorises a feed with their bank, then transactions are pulled with Sync now."
        }
        action={
          <span className="inline-flex items-center gap-2">
            <Button variant="secondary" size="sm" icon="send" onClick={() => setModal({ kind: "request" })}>
              Request feed
            </Button>
            {providerConfigured ? (
              <Button size="sm" icon="landmark" onClick={() => setModal({ kind: "connect" })}>
                Connect now
              </Button>
            ) : null}
          </span>
        }
      />

      {notice ? (
        <div className="px-5 pt-4">
          <Alert tone={notice.tone}>{notice.text}</Alert>
        </div>
      ) : null}

      {/* Without a registered webhook the provider cannot push anything to us,
          so a connected feed goes quiet and looks broken. Saying so is the
          difference between "waiting" and "waiting forever". */}
      {providerConfigured && !deliveryIsAutomatic && connections.length > 0 ? (
        <div className="px-5 pt-4">
          <Alert tone="warning" title="Automatic delivery is off">
            {providerName} has no webhook endpoint registered for this environment, so new
            transactions will not arrive on their own. Use <strong>Sync now</strong> to pull them.
          </Alert>
        </div>
      ) : null}

      {/* A lapsed consent stops the data without any error appearing anywhere,
          so it is called out above the table rather than left as a status. */}
      {renewals.length > 0 ? (
        <div className="px-5 pt-4">
          <Alert tone="warning" title="Consent expiring">
            {renewals.length === 1 ? "A consent expires" : `${renewals.length} consents expire`} soon.
            Data stops arriving on the expiry date until the client re-authorises.
          </Alert>
        </div>
      ) : null}

      <div className="flex items-center justify-between px-5 pt-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-3">Connections</h4>
        {providerConfigured && connections.length > 0 ? (
          <Button
            variant="secondary"
            size="sm"
            icon="refresh"
            disabled={busy === "refresh"}
            onClick={() =>
              run("refresh", () => refreshFeedConnections(clientId), "Consents checked against Fiskil.")
            }
          >
            Check consents
          </Button>
        ) : null}
      </div>

      {connections.length === 0 ? (
        <EmptyRow
          icon="landmark"
          title="No connection yet"
          body={
            providerConfigured
              ? "Send the client a request, or start the consent together with them using Connect now."
              : `Live connections are off in this environment: approvals are still recorded and statements come in by upload. Set the ${providerName} keys to enable them.`
          }
        />
      ) : (
        <table>
          <thead>
            <tr>
              <th>Institution</th>
              <th className="w-32">Connected</th>
              <th className="w-32">Expires</th>
              <th className="w-36">Last sync</th>
              <th className="w-40">Status</th>
              <th className="w-52 text-right">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {connections.map((connection) => (
              <tr key={connection.id}>
                <td>
                  <span className="font-medium">{connection.institutionName ?? "Bank"}</span>
                  {connection.accountCount > 0 ? (
                    <span className="block text-xs text-ink-3">
                      {connection.accountCount} account{connection.accountCount === 1 ? "" : "s"} from this feed
                    </span>
                  ) : null}
                  {connection.status === "ERROR" && connection.lastError ? (
                    <span className="block text-xs text-negative">{connection.lastError}</span>
                  ) : null}
                </td>
                <td className="figure text-ink-2">
                  {connection.consentedAt ? shortDate(connection.consentedAt) : "—"}
                </td>
                <td className="figure text-ink-2">
                  {connection.expiresAt ? (
                    <span className={connection.needsRenewal ? "text-warning" : undefined}>
                      {shortDate(connection.expiresAt)}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="figure text-ink-2">
                  {connection.lastSyncedAt ? shortDate(connection.lastSyncedAt) : "Never"}
                </td>
                <td>
                  <Badge tone={CONNECTION_STATUS[connection.status].tone}>
                    {CONNECTION_STATUS[connection.status].label}
                  </Badge>
                </td>
                <td className="text-right">
                  <span className="inline-flex items-center gap-1">
                    {connection.status === "ACTIVE" ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        icon="refresh"
                        disabled={busy === connection.id || !providerConfigured}
                        onClick={() =>
                          run(
                            connection.id,
                            () => syncFeed(clientId, connection.id),
                            "Sync queued — progress shows in the Activity Panel.",
                          )
                        }
                      >
                        Sync now
                      </Button>
                    ) : null}

                    {/* Renewal re-authorises the SAME arrangement, so the client
                        does not have to re-select their accounts. */}
                    {providerConfigured && (connection.needsRenewal || connection.status === "EXPIRED") ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setModal({ kind: "connect", renewId: connection.id })}
                      >
                        Renew
                      </Button>
                    ) : null}

                    {connection.canRevoke ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        icon="x-circle"
                        disabled={busy === connection.id}
                        onClick={() =>
                          run(
                            connection.id,
                            () => revokeFeedConnection(clientId, connection.id),
                            "Consent revoked with the bank.",
                          )
                        }
                      >
                        Revoke
                      </Button>
                    ) : null}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Requests */}
      <div className="border-t border-rule px-5 pt-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-3">Requests sent</h4>
      </div>
      {requests.length === 0 ? (
        <EmptyRow
          icon="send"
          title="No request sent yet"
          body="The client receives a secure link, reviews the request and approves access through their bank. The answer shows here."
        />
      ) : (
        <table>
          <thead>
            <tr>
              <th>Sent to</th>
              <th className="w-32">Sent</th>
              <th className="w-32">Expires</th>
              <th className="w-36">Status</th>
              <th className="w-28 text-right">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {requests.map((request) => (
              <tr key={request.id}>
                <td className="font-medium">{request.email}</td>
                <td className="figure text-ink-2">{shortDate(request.sentAt)}</td>
                <td className="figure text-ink-2">{shortDate(request.expiresAt)}</td>
                <td>
                  <Badge tone={REQUEST_STATUS[request.status].tone}>
                    {REQUEST_STATUS[request.status].label}
                  </Badge>
                </td>
                <td className="text-right">
                  {request.status === "PENDING" ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      icon="undo"
                      disabled={busy === request.id}
                      onClick={() =>
                        run(request.id, () => cancelFeedRequest(clientId, request.id), "Request withdrawn.")
                      }
                    >
                      Withdraw
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Provenance. Folded away by default — it answers "where did this
          transaction come from and when", which matters at audit, not daily. */}
      {syncRuns.length > 0 ? (
        <>
          <div className="flex items-center justify-between border-t border-rule px-5 pt-4">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-3">Sync history</h4>
            <Button variant="secondary" size="sm" icon={showRuns ? "eye-off" : "eye"} onClick={() => setShowRuns((open) => !open)}>
              {showRuns ? "Hide" : `Show ${syncRuns.length}`}
            </Button>
          </div>
          {showRuns ? (
            <table>
              <thead>
                <tr>
                  <th className="w-40">Started</th>
                  <th className="w-28">Trigger</th>
                  <th className="w-24">New</th>
                  <th className="w-24">Updated</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {syncRuns.map((runRow) => (
                  <tr key={runRow.id}>
                    <td className="figure text-ink-2">{shortDate(runRow.startedAt)}</td>
                    <td className="text-xs capitalize text-ink-2">{runRow.trigger.toLowerCase()}</td>
                    <td className="figure">{runRow.rowsInserted}</td>
                    <td className="figure text-ink-2">{runRow.rowsUpdated}</td>
                    <td>
                      {runRow.status === "ERROR" ? (
                        <span className="text-xs text-negative">{runRow.error ?? "Failed"}</span>
                      ) : (
                        <Badge tone={runRow.status === "OK" ? "positive" : "warning"}>
                          {runRow.status === "OK" ? "Complete" : "Running"}
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </>
      ) : null}

      <p className="border-t border-rule px-5 py-3 text-xs leading-relaxed text-ink-3">
        {deliveryIsAutomatic
          ? `${providerName} notifies us when a bank publishes new transactions, so this feed keeps itself current. `
          : ""}
        Feeds run through the Consumer Data Right via {providerName}, an accredited data recipient.
        Banking credentials are never seen or stored here; the client consents with their bank, the
        consent is time limited, and they can withdraw it at any time.
      </p>

      {modal?.kind === "request" ? (
        <FeedRequestModal clientId={clientId} onClose={() => setModal(null)} />
      ) : null}
      {modal?.kind === "connect" ? (
        <ConnectModal
          clientId={clientId}
          institutions={institutions}
          renewId={modal.renewId}
          onClose={() => setModal(null)}
          onDone={(text) => {
            setModal(null);
            setNotice({ tone: "positive", text });
            startTransition(() => router.refresh());
          }}
        />
      ) : null}
    </Card>
  );
}

/** An empty section of the card: what would be here, and how it gets here. */
function EmptyRow({ icon, title, body }: { icon: "landmark" | "send"; title: string; body: string }) {
  return (
    <div className="px-5 pb-5 pt-3">
      <div className="flex items-center gap-3.5 rounded-2xl border border-dashed border-rule bg-surface-2/60 px-4 py-3.5">
        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <Icon name={icon} className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">{title}</p>
          <p className="mt-0.5 text-[13px] leading-relaxed text-ink-2">{body}</p>
        </div>
      </div>
    </div>
  );
}

/** Also opened from the Banks empty state, where the card itself is not shown yet. */
export function FeedRequestModal({ clientId, onClose }: { clientId: string; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ previewUrl: string | null; mail: MailOutcome } | null>(null);

  function submit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await requestBankFeed(clientId, formData);
      if (result.ok) {
        setSent({ previewUrl: result.previewUrl, mail: result.mail });
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      icon="landmark"
      size="lg"
      title="Request bank feed"
      description="We send the client a secure link. They review the request and approve access directly with their bank."
    >
      {sent !== null ? (
        <>
          <div className="flex flex-col gap-3 px-5 py-5 sm:px-6">
            <Alert tone={sent.mail === "sent" ? "positive" : "warning"} title={sent.mail === "sent" ? "Request sent" : "Request created, but not emailed"}>
              The client has 14 days to respond. Its status shows on this page.
            </Alert>
            {sent.previewUrl ? (
              <p className="text-xs leading-relaxed text-ink-3">
                {sent.mail === "logged"
                  ? "No email provider is configured in this environment, so the link was written to the server log instead."
                  : "The email was refused, so the client has not received the link. Pass it on yourself, or fix the mail settings and request the feed again."}{" "}
                Link: <span className="code">{sent.previewUrl}</span>
              </p>
            ) : null}
          </div>
          <ModalFooter>
            <Button onClick={onClose}>Done</Button>
          </ModalFooter>
        </>
      ) : (
        <form onSubmit={submitWith(submit)}>
          <div className="flex flex-col gap-5 px-5 py-5 sm:px-6">
            {error ? <Alert tone="negative">{error}</Alert> : null}
            <Field
              label="Client email"
              name="email"
              type="email"
              required
              icon="mail"
              autoComplete="off"
              placeholder="name@client.com.au"
              hint="The bank sends a one-time code here during the consent, so it must be an address the client can read now."
            />
            <div className="flex items-start gap-3.5 rounded-2xl bg-accent-soft/50 px-5 py-4">
              <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-white">
                <Icon name="info" className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="text-[14px] font-semibold text-ink">Secure and read-only</p>
                <p className="mt-0.5 text-[13px] leading-relaxed text-ink-2">
                  Your client stays in control. We only request read-only access, and your client can revoke it at any time.
                </p>
              </div>
            </div>
          </div>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" icon="send" disabled={pending}>
              {pending ? "Sending…" : "Send request"}
            </Button>
          </ModalFooter>
        </form>
      )}
    </Modal>
  );
}

/**
 * Start the consent here and now, for a client sitting with the accountant.
 *
 * The server creates the auth session and hands back its id; `link()` opens
 * Fiskil's consent window with it. When the client finishes, the SDK resolves
 * with a consent id which we report straight away — the webhook is
 * authoritative and idempotent, so this only makes the screen truthful sooner.
 */
function ConnectModal({
  clientId,
  institutions,
  renewId,
  onClose,
  onDone,
}: {
  clientId: string;
  institutions: FeedInstitutionOption[];
  renewId?: string | undefined;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(formData: FormData) {
    setError(null);
    setBusy(true);
    try {
      if (renewId) formData.set("renewConnectionId", renewId);

      const started = await startFeedConnection(clientId, formData);
      if (!started.ok) {
        setError(started.error);
        return;
      }

      const result = await link(started.sessionId);

      if (result.consentID) {
        await completeFeedConnection(clientId, started.connectionId, result.consentID);
        onDone(
          renewId
            ? "Consent renewed. The feed continues without the client re-selecting accounts."
            : "Consent granted. Transactions will arrive shortly — Fiskil notifies us when the first batch is ready.",
        );
        return;
      }

      // The window closed without a consent. The PENDING row stays as the
      // record of an attempt, and the client can be asked again.
      setError("The consent window closed before a consent was granted.");
    } catch (caught) {
      setError(linkErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={renewId ? "Renew consent" : "Connect now"}
      description={
        renewId
          ? "Re-authorises the existing arrangement with the same bank, so the client keeps the accounts they already chose."
          : "Opens the bank consent window for the client to complete on this screen. Their banking credentials go to their bank, never to us."
      }
    >
      <form onSubmit={submitWith(submit)}>
        <div className="flex flex-col gap-4 px-5 py-5">
          {error ? <Alert tone="negative">{error}</Alert> : null}
          <Field
            label="Client email"
            name="email"
            type="email"
            required
            placeholder="name@client.com.au"
            hint="Identifies the client at Fiskil and receives the bank's one-time code."
          />
          {!renewId && institutions.length > 0 ? (
            <Select
              label="Bank"
              name="institutionId"
              hint="Optional. Leave as Any to let the client choose in the consent window."
            >
              <option value="">Any — let the client choose</option>
              {institutions.map((institution) => (
                <option key={institution.id} value={institution.id}>
                  {institution.name}
                </option>
              ))}
            </Select>
          ) : null}
        </div>
        <ModalFooter>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" icon="landmark" disabled={busy}>
            {busy ? "Opening…" : renewId ? "Renew consent" : "Open bank consent"}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
