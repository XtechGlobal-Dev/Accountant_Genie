import { requireSession } from "@/server/core/session";
import { can } from "@/server/core/permissions";
import { failedRowsCsv } from "@/server/modules/ingest/service";

/**
 * GET /clients/[id]/banks/imports/[importId]/failed-rows — the rows an import
 * could not read, as CSV, to fix and re-upload. The import is scoped to the
 * firm inside the service; a foreign id is 404.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string; importId: string }> }) {
  const session = await requireSession();
  if (!can(session, "statement:upload")) return new Response("Forbidden", { status: 403 });
  const { importId } = await context.params;

  const file = await failedRowsCsv(session.firmId, importId);
  if (!file) return new Response("Not found", { status: 404 });

  return new Response(file.csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${file.filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
