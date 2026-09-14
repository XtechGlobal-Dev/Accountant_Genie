import { BrandLogo } from "@/ui/icons";

/**
 * The signed-out frame: one centred column on the light ground — the logo,
 * then the form on a card, then a caption. No side panel.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main id="main" className="flex min-h-svh flex-col items-center justify-center bg-ground bg-mesh-light px-6 py-10">
      <BrandLogo className="mb-8 h-20" />
      <div className="card w-full max-w-md p-8 shadow-pop has-[[data-wide]]:max-w-xl lg:p-10">{children}</div>
      <p className="mt-8 text-center text-xs text-ink-3">Prepared for review. Nothing is lodged from here.</p>
    </main>
  );
}
