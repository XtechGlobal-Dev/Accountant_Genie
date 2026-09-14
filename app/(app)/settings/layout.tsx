import { SettingsNav } from "@/features/settings/components/settings-nav";

/**
 * Settings: a side list of sections with the way back, and the section itself.
 * The side list stretches to the height of the section beside it, so the
 * two always end on the same line.
 */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
      <SettingsNav />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
