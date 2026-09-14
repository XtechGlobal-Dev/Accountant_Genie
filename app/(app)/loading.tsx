/**
 * What every signed-in route shows while its server component resolves.
 *
 * Without this file the App Router has nowhere to suspend, so a click does
 * nothing visible until the whole page is ready — the old screen just sits
 * there and the app reads as broken rather than busy. With it, navigation is
 * immediate: the shell stays, this takes the content area, and the real page
 * streams in behind it.
 *
 * It also gives `<Link>` something to prefetch. A dynamic route otherwise has
 * no static part worth fetching ahead of the click; this boundary is that part.
 *
 * Deliberately generic — one skeleton for every route under `(app)`. A page
 * that deserves a shape of its own puts a `loading.tsx` in its own folder and
 * that one wins.
 */

/** One muted block. `animate-pulse` is the only motion; nothing here moves the layout. */
function Bar({ className = "" }: { className?: string }) {
  return <div className={`rounded-control bg-sunken ${className}`} />;
}

function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="rounded-card border border-rule bg-surface p-5 shadow-xs">
      <Bar className="h-4 w-1/3" />
      <div className="mt-4 flex flex-col gap-2.5">
        {Array.from({ length: lines }, (_, i) => (
          <Bar key={i} className={`h-3 ${i === lines - 1 ? "w-2/3" : "w-full"}`} />
        ))}
      </div>
    </div>
  );
}

export default function Loading() {
  return (
    <div className="animate-pulse p-1" aria-busy="true" aria-live="polite">
      {/* Screen readers get words; everyone else gets the shapes below. */}
      <span className="sr-only">Loading…</span>

      {/* Page heading */}
      <div className="flex flex-wrap items-center justify-between gap-4 px-1 py-4">
        <div className="flex flex-col gap-2">
          <Bar className="h-6 w-56" />
          <Bar className="h-3 w-72" />
        </div>
        <Bar className="h-9 w-32 rounded-full" />
      </div>

      {/* A row of figures, the way most sections open */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="rounded-card border border-rule bg-surface p-5 shadow-xs">
            <Bar className="h-3 w-24" />
            <Bar className="mt-3 h-7 w-20" />
          </div>
        ))}
      </div>

      {/* Then the body of the page */}
      <div className="mt-3 grid gap-3 xl:grid-cols-2">
        <CardSkeleton lines={5} />
        <CardSkeleton lines={5} />
      </div>
      <div className="mt-3">
        <CardSkeleton lines={6} />
      </div>
    </div>
  );
}
