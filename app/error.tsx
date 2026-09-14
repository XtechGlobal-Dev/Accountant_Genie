"use client";

/**
 * The last line of defence: a server render or action threw.
 *
 * In development the message is shown, because the most common cause on a
 * fresh checkout is a database behind the schema, and the message names the
 * commands. In production Next strips server error messages, so only the
 * digest is shown and the person is offered a way back.
 */

import { useEffect } from "react";
import { BrandLogo } from "@/ui/icons";
import { buttonClass } from "@/ui/styles";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const schemaBehind = error.message.includes("schema is behind");

  return (
    <main id="main" className="flex min-h-svh items-center justify-center bg-ground px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="mb-6">
          <BrandLogo className="h-9" />
        </div>
        <div className="card p-7">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-accent">
            {schemaBehind ? "Setup needed" : "Something went wrong"}
          </p>
          <h1 className="display mt-2 text-[1.5rem]">
            {schemaBehind ? "The database is behind the schema" : "This page could not load"}
          </h1>

          {schemaBehind ? (
            <>
              <p className="mt-3 text-sm leading-relaxed text-ink-2">
                Tables the app expects are missing. From the project folder, run these in order,
                then restart the dev server:
              </p>
              <pre className="code mt-4 overflow-x-auto rounded-control border border-rule bg-surface-2 px-4 py-3 text-[12.5px] leading-relaxed text-ink">
{`npx prisma db push --accept-data-loss
npm run db:constraints
npm run db:seed`}
              </pre>
              <p className="mt-3 text-xs leading-relaxed text-ink-3">
                Local development only. Staging and production run{" "}
                <span className="code">prisma migrate deploy</span>.
              </p>
            </>
          ) : (
            <p className="mt-3 text-sm leading-relaxed text-ink-2">
              {process.env.NODE_ENV === "development" ? error.message : "The error has been recorded."}
              {error.digest ? (
                <span className="code mt-2 block text-ink-3">ref {error.digest}</span>
              ) : null}
            </p>
          )}

          <div className="mt-6 flex flex-wrap gap-2">
            <button type="button" onClick={reset} className={buttonClass()}>
              Try again
            </button>
            <a href="/sign-in" className={buttonClass({ variant: "secondary" })}>
              Sign in
            </a>
          </div>
        </div>
      </div>
    </main>
  );
}
