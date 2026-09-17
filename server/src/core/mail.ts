import "server-only";

import type { MailOutcome } from "@/shared/contracts/result";

/**
 * Outbound email behind one interface.
 *
 * With `RESEND_API_KEY` and `MAIL_FROM` set, messages go through Resend's
 * HTTP API (no SDK needed). Otherwise the console transport writes the
 * message to the server log, and the UI says so. Nothing that sends mail
 * knows which transport is in use.
 *
 * Never put a password or a session token in a message. One-time codes and
 * signed, expiring links only.
 */

export type { MailOutcome };

export interface MailMessage {
  to: string;
  subject: string;
  /** Plain text. Kept simple on purpose. */
  text: string;
}

export interface MailTransport {
  readonly name: string;
  send(message: MailMessage): Promise<void>;
}

/** "j***@example.com" — enough to recognise, not enough to harvest. */
function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}

/**
 * Whether a message body may be written to the log.
 *
 * A body holds a sign-in code, a temporary password or a bank feed link, so
 * printing one hands a working credential to everyone who can read the log. On
 * a developer's own machine that is fine and is how the app has always worked
 * offline. In production the log is shared, retained and shipped elsewhere, so
 * it is not.
 *
 * `MAIL_DEBUG_LOG_BODIES=1` overrides that for a staging environment whose mail
 * is not configured yet and where a tester could otherwise never get past the
 * code entry screen. It is a deliberate, named, opt-in hole: everything it
 * prints is a live credential, so it belongs on staging with throwaway accounts
 * and never on an environment holding a real firm's books. Treat anything it
 * logs as disclosed, and clear the flag once mail works.
 */
function mayLogBodies(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  return process.env.MAIL_DEBUG_LOG_BODIES?.trim() === "1";
}
/**
 * Whether a one-time code may be handed to the browser that asked for it.
 *
 * Sibling of `MAIL_DEBUG_LOG_BODIES`, and the same bargain with a wider
 * blast radius: that one puts a live credential in the server log, where
 * only an operator sees it. This one puts it in the visitor's own page, so
 * anyone who reaches the code screen can read their code out of DevTools
 * without ever receiving the email.
 *
 * It exists because a deployed environment with no mail provider is a
 * locked door for everyone, including the people testing it. It is not a
 * fallback and it is not clever: it turns the second factor back into the
 * first, so the account is worth exactly its password while this is on.
 *
 * Two conditions, and both have to hold:
 *   1. `MAIL_DEBUG_ECHO_CODE=1` — named, deliberate, never a default.
 *   2. The message was only logged, not sent. The moment a provider is
 *      configured this stops on its own, which is the point: the hole
 *      closes when the reason for it goes away, not when someone remembers.
 *
 * Never set on an environment holding a real firm's books.
 */
export function mayEchoCodeToBrowser(): boolean {
  return process.env.MAIL_DEBUG_ECHO_CODE?.trim() === "1";
}

/**
 * The console transport is what runs when no provider is configured. It only
 * reports the outcome; the message itself is logged by `record` below, so that
 * one rule decides what reaches the log no matter which transport ran.
 */
class ConsoleTransport implements MailTransport {
  readonly name = "console";
  async send(): Promise<void> {}
}

class ResendTransport implements MailTransport {
  readonly name = "resend";
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(message: MailMessage): Promise<void> {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: this.from, to: [message.to], subject: message.subject, text: message.text }),
    });
    if (!response.ok) {
      // The provider's own diagnosis is the only thing that explains a refusal
      // ("this sender may only reach the account owner", "domain not verified"),
      // and discarding it turns a one-line configuration mistake into a day of
      // guessing. It is Resend's text about the request, never our message body,
      // so it goes to the log in full; the thrown error stays terse.
      const detail = await response.text().catch(() => "");
      console.error(`[mail] Resend refused the message (${response.status}): ${detail || "no detail"}`);
      throw new Error(`Mail provider responded ${response.status}`);
    }
  }
}

/**
 * The transport is chosen once. `deliver` is the only way out of this module:
 * callers get an outcome they must handle, not a promise that throws.
 */
let cached: MailTransport | null = null;

function getMailer(): MailTransport {
  if (cached) return cached;
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.MAIL_FROM?.trim();
  cached = apiKey && from ? new ResendTransport(apiKey, from) : new ConsoleTransport();
  return cached;
}

const RULE = "-".repeat(64);

/** What the log calls each outcome, so a tester can scan for the right block. */
const HEADLINE: Record<MailOutcome, string> = {
  sent: "mail sent",
  logged: "mail NOT SENT (no provider configured)",
  failed: "mail NOT SENT (the provider refused it)",
};

/**
 * Write one message to the log.
 *
 * Every message, not only the ones that failed to arrive: while mail is being
 * configured, a tester needs the code out of a *successful* send just as much,
 * and hunting for which emails happen to be logged is its own waste of time.
 * What varies is not which messages are printed but whether their bodies may
 * be — `mayLogBodies` owns that single decision, and when it says no the log
 * still records that a message went to a masked address, so the flow is
 * traceable without the credential.
 */
function record(outcome: MailOutcome, message: MailMessage): void {
  if (!mayLogBodies()) {
    // A delivered message needs no notice: it arrived, and naming recipients in
    // a production log is gratuitous. The two that did not arrive do.
    if (outcome === "sent") return;
    console.error(
      `[mail] ${HEADLINE[outcome]} — to ${maskEmail(message.to)} ("${message.subject}"). ` +
        `Its body is withheld from this log. Set MAIL_DEBUG_LOG_BODIES=1 to print it; it is a live credential.`,
    );
    return;
  }

  const warning =
    outcome === "sent" ? "" : `\n\nThis message did NOT arrive. Everything needed to continue by hand is above.`;
  const log = outcome === "sent" ? console.info : console.warn;
  log(
    `\n${RULE}\n[${HEADLINE[outcome]} → ${message.to}]\n${message.subject}\n\n${message.text}${warning}\n${RULE}\n`,
  );
}

/**
 * Send a message, log it, and report the outcome. **Never throws** — a refused
 * email is a fact to hand back, not a crash. Callers that have already
 * committed a row (an invited colleague, a feed request) carry on and offer the
 * credential or the link directly; callers that have not (a sign-in code)
 * return a form error and let the person retry.
 */
export async function deliver(message: MailMessage): Promise<MailOutcome> {
  const mailer = getMailer();
  let outcome: MailOutcome;
  try {
    await mailer.send(message);
    outcome = mailer.name === "console" ? "logged" : "sent";
  } catch {
    // The transport has already logged the provider's own explanation.
    outcome = "failed";
  }
  record(outcome, message);
  return outcome;
}
