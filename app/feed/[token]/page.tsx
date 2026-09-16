import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { consume } from "@/server/core/rate-limit";
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
 *
 * The answer is a POST. A GET that recorded consent would be recorded by
 * every link prefetcher, mail scanner and proxy that fetched the emailed
 * URL — a CDR consent must be an act, not a side effect of a click.
 *
 * Token lookups are throttled per address so the link space cannot be
 * walked; the token is 256 bits, the throttle is belt and braces.
 */

async function requestOrigin(): Promise<{ origin: string; ip: string | null }> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const proto = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const forwarded = requestHeaders.get("x-forwarded-for");
  const ip = (forwarded ? forwarded.split(",")[0]?.trim() : requestHeaders.get("x-real-ip")) ?? null;
  return { origin: `${proto}://${host}`, ip };
}

async function throttled(ip: string | null): Promise<boolean> {
  const limit = await consume(`feed-token:${ip ?? "unknown"}`, 30, 15 * 60_000);
  return !limit.ok;
}

/** Records the client's answer. A server action: reachable only by POST. */
async function answer(formData: FormData) {
  "use server";
  const token = String(formData.get("token") ?? "");
  const choice = String(formData.get("answer") ?? "");
  if (!token || (choice !== "approve" && choice !== "decline")) return;
  const { origin, ip } = await requestOrigin();
  if (await throttled(ip)) return;

  const outcome = await respondToFeedRequest(token, choice === "approve", origin);
  // With a provider configured, approval continues at the bank's consent
  // page. `redirect` throws, so nothing below it runs on the happy path.
  if (outcome.consentUrl) redirect(outcome.consentUrl);
  redirect(`/feed/${encodeURIComponent(token)}?done=1${outcome.error ? "&provider=unavailable" : ""}`);
}

export default async function FeedRequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ done?: string; provider?: string }>;
}) {
  const { token } = await params;
  const { done, provider } = await searchParams;
  const { ip } = await requestOrigin();

  const view = (await throttled(ip)) ? null : await findFeedRequestByToken(token);
  const responded = done === "1";
  const consentError = provider === "unavailable";

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
            <form action={answer} className="mt-6 flex gap-2">
              <input type="hidden" name="token" value={token} />
              <button type="submit" name="answer" value="decline" className={buttonClass({ variant: "secondary", className: "flex-1" })}>
                Decline
              </button>
              <button type="submit" name="answer" value="approve" className={buttonClass({ className: "flex-1" })}>
                Approve
              </button>
            </form>
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
