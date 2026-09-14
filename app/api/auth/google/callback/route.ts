import { redirect } from "next/navigation";
import { completeGoogleSignIn } from "@/server/modules/auth/google";

/** GET /api/auth/google/callback — Google returns here with a code. */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const result = await completeGoogleSignIn(
    url.searchParams.get("code"),
    url.searchParams.get("state"),
    `${url.origin}/api/auth/google/callback`,
  );
  if (!result.ok) redirect(`/sign-in?error=${encodeURIComponent(result.error)}`);
  redirect(result.next);
}
