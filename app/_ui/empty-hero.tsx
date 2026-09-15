"use client";

/**
 * The empty state for a section that has nothing in it yet and offers a few
 * ways to start: an illustration, a heading, the ways in as cards, and a
 * note on what to expect. Used by a client with no data and by a client
 * with no bank account; both should read as the same moment.
 *
 * `HeroAction` takes either an `href` or an `onClick`, so a server component
 * can link to a page and a client component can open a modal in place.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, type IconName } from "@/ui/icons";
import { cx } from "@/ui/styles";

export function EmptyHero({
  title,
  body,
  children,
  note,
  className,
}: {
  title: string;
  body: string;
  /** The ways in: `HeroAction`s, with a `HeroDivider` between groups. */
  children: ReactNode;
  note?: { title: string; body: string } | undefined;
  className?: string | undefined;
}) {
  return (
    <section
      className={cx(
        "relative flex min-h-[calc(100svh-13rem)] items-center justify-center overflow-hidden rounded-card border border-rule bg-surface px-6 py-14 shadow-card",
        className,
      )}
    >
      {/* Soft ground: two pale blobs, one each side, so the centre reads as the focus. */}
      <span aria-hidden="true" className="pointer-events-none absolute -left-32 top-1/2 size-[28rem] -translate-y-1/2 rounded-full bg-accent-soft/70 blur-3xl" />
      <span aria-hidden="true" className="pointer-events-none absolute -right-32 top-1/3 size-[26rem] rounded-full bg-accent-soft/50 blur-3xl" />

      <div className="relative flex w-full max-w-2xl flex-col items-center text-center">
        <HeroIllustration />
        <h2 className="display mt-8 text-[1.75rem]">{title}</h2>
        <p className="mt-2 max-w-md text-[15px] leading-relaxed text-ink-2">{body}</p>
        <div className="mt-8 flex w-full flex-col items-center gap-0">{children}</div>
        {note ? (
          <div className="mt-8 flex w-full items-start gap-3 rounded-2xl bg-accent-soft/50 px-5 py-4 text-left">
            <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-white">
              <Icon name="info" className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-ink">{note.title}</p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-ink-2">{note.body}</p>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** "Or", between two groups of ways in. */
export function HeroDivider() {
  return (
    <div className="my-5 flex w-full items-center gap-4 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-3">
      <span className="h-px flex-1 bg-rule" />
      Or
      <span className="h-px flex-1 bg-rule" />
    </div>
  );
}

export function HeroAction({
  href,
  onClick,
  icon,
  title,
  body,
  primary = false,
  className,
}: {
  href?: string | undefined;
  onClick?: (() => void) | undefined;
  icon: IconName;
  title: string;
  body: string;
  primary?: boolean | undefined;
  className?: string | undefined;
}) {
  const classes = cx(
    "group flex w-full items-center gap-4 rounded-2xl px-5 py-4 text-left transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/25",
    primary
      ? "bg-accent-gradient text-white shadow-[0_12px_28px_-12px_rgba(37,99,235,0.6)] hover:shadow-glow"
      : "border border-rule bg-surface text-ink shadow-xs hover:border-accent/40 hover:shadow-card",
    className,
  );
  const inner = (
    <>
      <span
        className={cx(
          "inline-flex size-11 shrink-0 items-center justify-center rounded-xl",
          primary ? "bg-white/15 text-white" : "bg-accent-soft text-accent",
        )}
      >
        <Icon name={icon} className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-bold leading-tight">{title}</span>
        <span className={cx("mt-0.5 block text-[12px] leading-snug", primary ? "text-white/80" : "text-ink-2")}>{body}</span>
      </span>
      <Icon
        name="arrow-right"
        className={cx("size-4 shrink-0 transition-transform group-hover:translate-x-0.5", primary ? "text-white/90" : "text-accent")}
      />
    </>
  );
  return href ? (
    <Link href={href} className={classes}>
      {inner}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={classes}>
      {inner}
    </button>
  );
}

/**
 * The bank and the statement side by side, a dotted arc over them and a plus
 * where the statement meets the books. One SVG, so every part is placed
 * exactly and takes its colour from the theme rather than a raster.
 */
export function HeroIllustration() {
  const star = "M0 -8 C0 -3 3 0 8 0 C3 0 0 3 0 8 C0 3 -3 0 -8 0 C-3 0 0 -3 0 -8 Z";
  return (
    <svg viewBox="0 0 280 170" className="h-40 w-[17.5rem] max-w-full" aria-hidden="true" fill="none">
      {/* Dotted arc: round caps on a zero-length dash draw the dots. */}
      <path
        d="M30 118 C 70 10, 210 10, 250 118"
        className="stroke-accent"
        strokeOpacity="0.55"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray="0.1 8"
      />
      <circle cx="30" cy="118" r="3.5" className="fill-accent" fillOpacity="0.7" />
      <circle cx="197" cy="53" r="3.5" className="fill-accent" fillOpacity="0.7" />
      <circle cx="250" cy="118" r="2.5" className="fill-accent" fillOpacity="0.5" />

      {/* Sparkles */}
      <path d={star} transform="translate(20 92)" className="fill-accent" fillOpacity="0.65" />
      <path d={star} transform="translate(262 82) scale(0.8)" className="fill-accent" fillOpacity="0.55" />
      <path d={star} transform="translate(246 66) scale(0.4)" className="fill-accent" fillOpacity="0.5" />

      {/* Bank tile */}
      <rect x="52" y="50" width="84" height="84" rx="22" className="fill-accent-soft" />
      <g className="stroke-accent" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M74 82 L94 70 L114 82 Z" className="fill-accent" fillOpacity="0.15" />
        <path d="M80 88 V104 M89.5 88 V104 M98.5 88 V104 M108 88 V104" />
        <path d="M76 110 H112" />
      </g>

      {/* Statement tile, floating a little lower than the bank */}
      <rect x="152" y="64" width="66" height="82" rx="16" className="fill-surface stroke-rule drop-shadow-[0_10px_18px_rgba(15,19,48,0.10)]" strokeWidth="1" />
      <g className="fill-ink-3">
        <rect x="166" y="82" width="34" height="4" rx="2" fillOpacity="0.7" />
        <rect x="166" y="94" width="38" height="4" rx="2" fillOpacity="0.4" />
        <rect x="166" y="106" width="24" height="4" rx="2" fillOpacity="0.4" />
        <rect x="166" y="118" width="30" height="4" rx="2" fillOpacity="0.3" />
      </g>

      {/* The plus where the statement meets the books */}
      <circle cx="218" cy="146" r="17" className="fill-surface" />
      <circle cx="218" cy="146" r="14" className="fill-accent" />
      <path d="M218 139.5 V152.5 M211.5 146 H224.5" className="stroke-white" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
