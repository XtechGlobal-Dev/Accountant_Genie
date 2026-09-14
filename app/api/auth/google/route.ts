import { redirect } from "next/navigation";
import { beginGoogleSignIn, googleConfigured } from "@/server/modules/auth/google";

/** GET /api/auth/google — send the browser to Google. */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!googleConfigured()) redirect("/sign-in");
  const origin = new URL(request.url).origin;
  const url = await beginGoogleSignIn(`${origin}/api/auth/google/callback`);
  redirect(url);
}
