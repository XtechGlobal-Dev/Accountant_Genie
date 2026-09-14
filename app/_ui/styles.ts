/**
 * Class-name helpers shared by server and client components.
 *
 * Kept out of `primitives.tsx` on purpose: that file is a client module, and a
 * server component may only import *components* from a client module — calling
 * a plain function from one throws at render. Anything a server page needs to
 * call lives here.
 */

export function cx(
  ...parts: ReadonlyArray<string | false | null | undefined>
): string {
  return parts.filter(Boolean).join(" ");
}

export type ButtonVariant = "primary" | "secondary" | "ghost" | "soft" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

// Rounded, confident. The primary carries the accent gradient and a glow that
// deepens on hover; everything else stays quiet so the primary is the one
// thing on the screen that asks to be pressed.
const BUTTON_BASE =
  "inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-xl border font-semibold transition-[background-color,border-color,box-shadow,transform,color,filter] duration-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/25 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 disabled:active:translate-y-0 [&>svg]:size-4 [&>svg]:shrink-0";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "border-transparent bg-accent-gradient text-white shadow-[0_8px_20px_-8px_rgba(37,99,235,0.55),inset_0_1px_0_rgba(255,255,255,0.18)] hover:shadow-glow hover:brightness-110",
  secondary:
    "border-rule bg-surface text-ink shadow-xs hover:border-accent/40 hover:text-accent-ink hover:shadow-card",
  ghost: "border-transparent bg-transparent text-ink-2 hover:bg-sunken hover:text-ink",
  soft: "border-transparent bg-accent-soft text-accent-ink hover:bg-accent/15",
  danger:
    "border-transparent bg-[linear-gradient(135deg,#f04461,#e11d48)] text-white shadow-[0_8px_20px_-8px_rgba(225,29,72,0.55)] hover:brightness-110",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "h-9 px-3.5 text-[13px] [&>svg]:size-3.5",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-[15px]",
};

export function buttonClass({
  variant = "primary",
  size = "md",
  className,
}: {
  variant?: ButtonVariant | undefined;
  size?: ButtonSize | undefined;
  className?: string | undefined;
} = {}): string {
  return cx(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className);
}

export const inputClass =
  "w-full rounded-xl border border-rule bg-surface px-3.5 py-2.5 text-sm text-ink shadow-xs outline-none transition-[border-color,box-shadow,background-color] duration-150 placeholder:text-ink-3 hover:border-rule-strong focus:border-accent focus:ring-4 focus:ring-accent/15 focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-sunken disabled:text-ink-3 aria-invalid:border-negative aria-invalid:focus:ring-negative/15";
