import type { Metadata } from "next";
import { requireSession } from "@/server/core/session";
import { can } from "@/server/core/permissions";
import { listAudit } from "@/server/modules/firms/service";
import { Alert, Badge, PageHeader } from "@/ui/primitives";

export const metadata: Metadata = { title: "Audit trail" };

function Snapshot({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="text-ink-3">—</span>;
  return <pre className="code max-w-[24rem] overflow-x-auto whitespace-pre-wrap text-[11px] leading-snug text-ink-2">{JSON.stringify(value)}</pre>;
}

/** Append-only. Every accounting mutation, who did it, and what changed. */
export default async function AuditPage() {
  const session = await requireSession();
  if (!can(session, "audit:read")) {
    return (
      <Alert tone="warning" title="Audit trail">
        Your role cannot read the audit trail. Ask an owner or admin.
      </Alert>
    );
  }
  const rows = await listAudit(session.firmId);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Audit trail"
        context="Every accounting mutation, written inside the same transaction as the change. Rows are never edited or deleted."
      />
      {rows.length === 0 ? (
        <p className="card px-5 py-8 text-center text-sm text-ink-2">Nothing recorded yet.</p>
      ) : (
        <div className="sheet overflow-x-auto">
          <table className="min-w-[64rem]">
            <thead>
              <tr>
                <th className="w-40">When</th>
                <th className="w-48">Action</th>
                <th className="w-40">By</th>
                <th className="w-44">Client</th>
                <th className="w-36">Entity</th>
                <th>Before</th>
                <th>After</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="figure text-ink-2">
                    {new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeStyle: "short", timeZone: "Australia/Sydney" }).format(row.createdAt)}
                  </td>
                  <td>
                    <Badge tone="outline">{row.action.toLowerCase().replace(/_/g, " ")}</Badge>
                  </td>
                  <td className="text-ink-2">{row.userName ?? "System"}</td>
                  <td className="text-ink-2">{row.clientName ?? "—"}</td>
                  <td>
                    <span className="text-ink-2">{row.entityType}</span>
                    <span className="code block truncate text-ink-3" title={row.entityId}>
                      {row.entityId.slice(0, 12)}
                    </span>
                  </td>
                  <td>
                    <Snapshot value={row.before} />
                  </td>
                  <td>
                    <Snapshot value={row.after} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
