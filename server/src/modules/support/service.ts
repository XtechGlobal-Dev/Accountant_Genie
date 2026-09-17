import "server-only";

import { db } from "@/server/core/db";
import { recordAudit } from "@/server/core/audit";
import { deliver } from "@/server/core/mail";
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

  const outcome = await deliver({
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

  // Nothing else keeps this message — there is no support ticket table — so a
  // refused email loses it entirely. Say so and let them send it again rather
  // than report success over a message that went nowhere.
  if (outcome === "failed") {
    return { ok: false, error: "We could not send your message just now. Please try again in a moment." };
  }

  // The fact of the request, not its text: "who asked for help, about what
  // area, when" is worth having when a firm later disputes what was said.
  await db.$transaction(async (tx) => {
    await recordAudit(tx, {
      firmId,
      userId: user.id,
      action: "SUPPORT_REQUESTED",
      entityType: "Firm",
      entityId: firmId,
      after: { category: input.category, subject: input.subject.slice(0, 120), page: input.page ?? null },
    });
  });

  return { ok: true, id: "sent", consoleOnly: outcome === "logged" };
}
