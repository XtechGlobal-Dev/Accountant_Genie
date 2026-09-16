import { requireSession } from "@/server/core/session";
import { can } from "@/server/core/permissions";
import { resolvePeriod } from "@/server/modules/reports/period";
import { getJournalExport } from "@/server/modules/reports/service";

/**
 * GET /clients/[id]/journals/export?format=xero|myob&fy=…&q=… — the period's
 * journals as another system imports them. Session, permission, service, file.
 */
// Reads the session, so it can never be static.
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!can(session, "report:export")) return new Response("Forbidden", { status: 403 });

  const { id } = await context.params;
  const url = new URL(request.url);
  const format = url.searchParams.get("format") === "myob" ? "myob" : "xero";
  const period = resolvePeriod({
    fy: url.searchParams.get("fy") ?? undefined,
    q: url.searchParams.get("q") ?? undefined,
    m: url.searchParams.get("m") ?? undefined,
  });

  const file = await getJournalExport(session.firmId, id, period, format);
  if (!file) return new Response("Not found", { status: 404 });

  return new Response(file.body, {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `attachment; filename="${file.filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
