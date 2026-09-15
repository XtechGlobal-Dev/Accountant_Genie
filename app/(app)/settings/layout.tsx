import { SettingsNav } from "@/features/settings/components/settings-nav";

/**
 * Settings: a side list of sections with the way back, and the section itself.
 * The side list is sticky and ends on the same line as the main sidebar: the
 * shell's bottom padding is pulled back on the row and re-applied to the
 * section column only, so the list runs to the foot of the viewport while a
 * long section still keeps clear of the orb.
 */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 lg:-mb-20 lg:flex-row lg:items-start">
      <SettingsNav />
      <div className="min-w-0 flex-1 lg:pb-20">{children}</div>
    </div>
  );
}
