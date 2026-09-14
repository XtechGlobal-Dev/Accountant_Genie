import { requireSession } from "@/server/core/session";
import { chartToCsv } from "@/server/modules/accounts/service";

/**
 * GET /accounts/export[?client=<id>] — the chart of accounts as CSV.
 *
 * Resolve the session, call the service, return the file. The client ID is
 * request-supplied and is scoped by the firm inside the service's query, so a
 * foreign ID simply yields the firm-wide chart.
 */
export async function GET(request: Request) {
  const { firmId } = await requireSession();
  const clientId = new URL(request.url).searchParams.get("client") ?? undefined;

  const csv = await chartToCsv(firmId, clientId);
  const stamp = new Date().toISOString().slice(0, 10);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="chart-of-accounts-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
