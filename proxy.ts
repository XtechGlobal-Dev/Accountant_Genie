import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic sign-in redirect. This is UX, not security: it sends a browser
 * with no session cookie to the sign-in page before a server render starts.
 * Every page and server action still resolves the session itself and is the
 * real boundary.
 */

const SESSION_COOKIE = "ledgerly_session";

/**
 * Paths the optimistic redirect must not touch.
 *
 * `/api/` is here because none of those routes are a browser being sent to a
 * sign-in page, and a 307 to /sign-in is a silent, total failure for each of
 * them:
 *
 *   - `/api/webhooks/fiskil` and `/api/stripe/webhook` are called by Fiskil
 *     and Stripe, which never carry a session cookie. Redirected, the bank
 *     feed never delivers and the Stripe webhook — the only thing that
 *     changes a firm's plan — never fires.
 *   - `/api/auth/google/callback` is where Google returns the person, BEFORE
 *     a session exists. Redirecting it makes Google sign-in impossible.
 *
 * This costs nothing in safety: every one of those routes authenticates
 * itself — by HMAC signature, by OAuth state, or by resolving the session and
 * answering 401 — and this middleware was never the boundary anyway.
 */
const PUBLIC = [
  /^\/sign-in$/,
  /^\/sign-up$/,
  /^\/verify$/,
  /^\/forgot$/,
  /^\/reset$/,
  /^\/feed\//,
  /^\/api\//,
];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const signedIn = request.cookies.has(SESSION_COOKIE);
  const isPublic = PUBLIC.some((pattern) => pattern.test(pathname));

  if (!signedIn && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.search = "";
    return NextResponse.redirect(url);
  }
  // A page found the cookie's session gone and sent the person here: let them
  // through and drop the dead cookie, rather than bouncing back to / forever.
  if (signedIn && pathname === "/sign-in" && request.nextUrl.searchParams.has("expired")) {
    const response = NextResponse.next();
    response.cookies.delete(SESSION_COOKIE);
    return response;
  }
  if (signedIn && (pathname === "/sign-in" || pathname === "/sign-up")) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/|favicon\\.ico|.*\\.(?:png|jpg|svg|ico|css|js|map)$).*)"],
};
