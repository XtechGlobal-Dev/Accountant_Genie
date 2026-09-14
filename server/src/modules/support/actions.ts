"use server";

import { requireSession } from "@/server/core/session";
import { invalid } from "@/server/core/result";
import { supportRequestFromForm } from "./schema";
import * as service from "./service";

/** Anyone signed in may ask for help. */
export async function sendSupportRequest(formData: FormData): Promise<service.SupportResult> {
  const session = await requireSession();
  const parsed = supportRequestFromForm(formData);
  if (!parsed.success) return invalid(parsed.error);
  return service.sendSupportRequest(
    session.firmId,
    { id: session.userId, name: session.userName, email: session.email },
    parsed.data,
  );
}
