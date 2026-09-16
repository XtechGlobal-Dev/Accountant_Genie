import "server-only";

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
 * The console transport is a development convenience, and it prints one-time
 * codes and temporary passwords. That is acceptable on a developer's own
 * machine and never in production, where a server log is shared, retained and
 * shipped elsewhere. So: outside production the whole message is printed;
 * in production the body is withheld, the recipient is masked, and the log
 * says loudly that no mail provider is configured.
 */
class ConsoleTransport implements MailTransport {
  readonly name = "console";
  async send(message: MailMessage): Promise<void> {
    const line = "-".repeat(64);
    if (process.env.NODE_ENV === "production") {
      console.error(
        `[mail] No mail provider is configured (RESEND_API_KEY / MAIL_FROM). ` +
          `A message to ${maskEmail(message.to)} ("${message.subject}") was NOT sent and its body is withheld from this log.`,
      );
      return;
    }
    console.info(`\n${line}\n[mail → ${message.to}] ${message.subject}\n${message.text}\n${line}\n`);
  }
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
      // The body may describe the failure but never the message; log the status only.
      throw new Error(`Mail provider responded ${response.status}`);
    }
  }
}

let cached: MailTransport | null = null;

export function getMailer(): MailTransport {
  if (cached) return cached;
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.MAIL_FROM?.trim();
  cached = apiKey && from ? new ResendTransport(apiKey, from) : new ConsoleTransport();
  return cached;
}

/** True when messages only reach the log, so the UI can say so. */
export function mailIsConsoleOnly(): boolean {
  return getMailer().name === "console";
}
