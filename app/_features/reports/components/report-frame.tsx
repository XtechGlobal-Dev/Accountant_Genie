import type { ReactNode } from "react";
import { ButtonLink } from "@/ui/primitives";
import { ReportActions } from "./report-actions";

/**
 * The frame every report shares: the picker on the left, a way back on the
 * right, then a titled sheet. Server-renderable; the picker inside it is the
 * only client component.
 */
export function ReportFrame({
  clientId,
  picker,
  title,
  subtitle,
  children,
  footnote,
}: {
  clientId: string;
  picker: ReactNode;
  title: string;
  subtitle: ReactNode;
  children: ReactNode;
  footnote?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5">
      <div data-print-hide className="flex flex-wrap items-center justify-between gap-3">
        {picker}
        <span className="flex flex-wrap items-center gap-2">
          <ReportActions filename={title.toLowerCase().replace(/[^a-z0-9]+/g, "-")} />
          <ButtonLink variant="secondary" icon="arrow-left" href={`/clients/${clientId}/reports`}>
            All reports
          </ButtonLink>
        </span>
      </div>
      <div className="sheet">
        <div className="relative overflow-hidden border-b border-rule bg-mesh-light px-6 py-5">
          <h2 className="display text-[1.5rem]">{title}</h2>
          <p className="mt-1 text-[13px] text-ink-2">{subtitle}</p>
        </div>
        {children}
      </div>
      {footnote ? <p className="text-xs leading-relaxed text-ink-3">{footnote}</p> : null}
    </div>
  );
}
