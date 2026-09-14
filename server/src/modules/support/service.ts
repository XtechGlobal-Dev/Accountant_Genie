import "server-only";

import { getMailer, mailIsConsoleOnly } from "@/server/core/mail";
import { consume } from "@/server/core/rate-limit";
import * as firms from "@/server/modules/firms/repository";
import type { ActionResult } from "@/shared/contracts/result";
import { SUPPORT_CATEGORY_LABELS, type SupportRequestInput } from "./schema";

/**
 * Support requests go out as email to the support inbox, with who and where
 * attached so nobody has to ask. Throttled per person: a stuck form should
 * not turn into fifty emails.
 *
 * `SUPPORT_EMAIL` names the inbox. Without it, and without a mail provider,
 * the message lands in the server log the way every other email does.
 */

const PER_HOUR = 5;

export type SupportResult = ActionResult & { consoleOnly?: boolean };

export async function sendSupportRequest(
  firmId: string,
  user: { id: string; name: string; email: string },
  input: SupportRequestInput,
): Promise<SupportResult> {
  const limit = await consume(`support:${user.id}`, PER_HOUR, 60 * 60_000);
  if (!limit.ok) {
    const minutes = Math.max(1, Math.ceil(limit.retryAfterMs / 60_000));
    return { ok: false, error: `That is enough for now — try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` };
  }

  const firm = await firms.findFirmName(firmId);
  const inbox = process.env.SUPPORT_EMAIL?.trim() || "support@accountantgenie.local";
  const label = SUPPORT_CATEGORY_LABELS[input.category];

  await getMailer().send({
    to: inbox,
    subject: `[${label}] ${input.subject}`,
    text:
      `${input.message}\n\n` +
      `—\n` +
      `From: ${user.name} <${user.email}>\n` +
      `Firm: ${firm?.name ?? firmId} (${firmId})\n` +
      (input.page ? `Page: ${input.page}\n` : "") +
      `Category: ${label}\n`,
  });

  return { ok: true, id: "sent", consoleOnly: mailIsConsoleOnly() };
}
