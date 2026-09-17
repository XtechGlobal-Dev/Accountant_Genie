import { requireSession } from "@/server/core/session";
import { getClientLogo } from "@/server/modules/clients/service";

/**
 * GET /clients/[id]/logo — the client's logo, for the firm that owns it.
 *
 * Resolve the session, ask the service, stream the bytes. A client of
 * another firm is indistinguishable from a client with no logo: 404 both
 * ways. Logos are stored outside the web root and only ever served here.
 */
// Reads the session, so it can never be static.
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { firmId } = await requireSession();

  const logo = await getClientLogo(firmId, id);
  if (!logo) return new Response(null, { status: 404 });

  return new Response(new Uint8Array(logo.bytes), {
    headers: {
      "Content-Type": logo.contentType,
      "Content-Length": String(logo.bytes.length),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
