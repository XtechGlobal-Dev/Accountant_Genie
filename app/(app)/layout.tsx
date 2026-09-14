import { requireSession } from "@/server/core/session";
import { getWorkspace } from "@/server/modules/firms/service";
import { AppShell } from "@/features/shell/components/app-shell";

/**
 * The signed-in shell. Every route in this group renders inside it, so no page
 * has to wrap itself and none can forget.
 *
 * The frame's data — the firm, the client list, the transaction count behind
 * the usage meter — is loaded once here rather than in each page, so moving
 * between sections never refetches the chrome.
 *
 * The route group `(app)` does not appear in the URL: /clients stays /clients.
 */

/**
 * Tenant data is never prerendered. At Stage 0 the firm is resolved by a
 * database lookup rather than a cookie, so Next cannot tell these routes are
 * request-scoped and would otherwise bake one firm's clients and accounts into
 * the build output. Phase 1's cookie-backed session makes this implicit; the
 * marker stays because the guarantee should not rest on that detail.
 */
export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { firmId, userName } = await requireSession();
  const workspace = await getWorkspace(firmId, userName);

  return <AppShell workspace={workspace}>{children}</AppShell>;
}
