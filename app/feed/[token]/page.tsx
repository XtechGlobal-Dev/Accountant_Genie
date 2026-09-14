import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { findFeedRequestByToken, respondToFeedRequest } from "@/server/modules/banking/feeds";
import { shortDate } from "@/shared/format";
import { BrandLogo } from "@/ui/icons";
import { buttonClass } from "@/ui/styles";

export const metadata: Metadata = { title: "Bank feed request" };
export const dynamic = "force-dynamic";

/**
 * The client's side of a bank feed request. No sign-in: the token in the
 * link is the credential, single-use and time-limited. The page shows who is
 * asking and for which business, and records the answer.
 */
export default async function FeedRequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ answer?: string }>;
}) {
  const { token } = await params;
  const { answer } = await searchParams;

  let view = await findFeedRequestByToken(token);
  let responded = false;
  let consentError: string | null = null;

  if (view && view.status === "PENDING" && (answer === "approve" || answer === "decline")) {
    const requestHeaders = await headers();
    const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
    const proto = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
    const outcome = await respondToFeedRequest(token, answer === "approve", `${proto}://${host}`);
    responded = outcome.recorded;
    // With a provider configured, approval continues at the bank's consent
    // page. `redirect` throws, so nothing below it runs on the happy path.
    if (outcome.consentUrl) redirect(outcome.consentUrl);
    // The answer is recorded either way — the firm must not lose the fact that
    // the client agreed just because the provider was briefly unreachable.
    consentError = outcome.error;
    view = await findFeedRequestByToken(token);
  }

  return (
    <main id="main" className="flex min-h-svh items-center justify-center bg-ground px-4 py-10">
      <div className="card w-full max-w-md p-7">
        <div>
          <BrandLogo className="h-10" />
        </div>

        {!view ? (
          <>
            <h1 className="mt-6 text-xl font-semibold tracking-tight">This link is not valid</h1>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">
              It may have been withdrawn, or the address was copied incompletely. Ask your
              accountant to send a new request.
            </p>
          </>
        ) : view.status === "PENDING" ? (
          <>
            <h1 className="mt-6 text-xl font-semibold tracking-tight">Authorise a bank feed</h1>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">
              <span className="font-medium text-ink">{view.firmName}</span> is asking to receive
              bank transactions for <span className="font-medium text-ink">{view.businessName}</span>{" "}
              automatically, so statements no longer have to be uploaded by hand.
            </p>
            <ul className="mt-4 flex flex-col gap-2 text-sm text-ink-2">
              <li>· You approve access with your bank, not with us.</li>
              <li>· Your banking password is never seen or stored.</li>
              <li>· Only transaction data is shared — never the ability to move money.</li>
              <li>· The authorisation expires on its own, and you can withdraw it at any time.</li>
            </ul>
            <p className="mt-3 text-xs leading-relaxed text-ink-3">
              Data is shared under Australia&rsquo;s Consumer Data Right through{" "}
              {view.providerName}, an accredited data recipient.
            </p>
            <p className="mt-4 text-xs text-ink-3">This request expires on {shortDate(view.expiresAt)}.</p>
            <div className="mt-6 flex gap-2">
              <a href={`?answer=decline`} className={buttonClass({ variant: "secondary", className: "flex-1" })}>
                Decline
              </a>
              <a href={`?answer=approve`} className={buttonClass({ className: "flex-1" })}>
                Approve
              </a>
            </div>
          </>
        ) : view.status === "CONNECTED" ? (
          <>
            <h1 className="mt-6 text-xl font-semibold tracking-tight">
              {responded ? "Thank you — authorised" : "Already authorised"}
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">
              {consentError
                ? `Your approval has been recorded, but the connection to ${view.providerName} could not be opened just now. ${view.firmName} will be in touch to finish it — nothing is lost.`
                : `${view.firmName} has been notified. If they have a live feed connected, you were taken to your bank to complete the consent; otherwise they will keep importing statements for ${view.businessName} until one is set up.`}
            </p>
          </>
        ) : view.status === "DECLINED" ? (
          <>
            <h1 className="mt-6 text-xl font-semibold tracking-tight">Request declined</h1>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">
              No feed will be connected. {view.firmName} has been notified and can still import
              statements you send them.
            </p>
          </>
        ) : (
          <>
            <h1 className="mt-6 text-xl font-semibold tracking-tight">This request has expired</h1>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">
              Ask {view.firmName} to send a new one if you would still like to connect a feed.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
