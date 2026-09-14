"use client";

/**
 * Shared interface pieces.
 *
 * `SubmitButton` reads the form status rather than taking a prop, so a form
 * physically cannot ship without a pending state. Users double-submit when a
 * three-second action gives no feedback, and in a ledger a double submit is a
 * duplicated transaction.
 */

import "client-only";

import { useEffect, useState, type ChangeEvent, type ComponentProps, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { Icon, type IconName } from "./icons";
import { Portal } from "./portal";
import {
  buttonClass,
  cx,
  inputClass,
  type ButtonSize,
  type ButtonVariant,
} from "./styles";

// Re-exported for client components. Server components import from
// `@/ui/styles` directly — see the note there.
export { buttonClass, cx, inputClass };
export type { ButtonSize, ButtonVariant };

/* ------------------------------------------------------------------------ */
/* Spinner                                                                  */
/* ------------------------------------------------------------------------ */

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`animate-spin ${className}`}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
        opacity="0.25"
      />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* ------------------------------------------------------------------------ */
/* Buttons                                                                  */
/* ------------------------------------------------------------------------ */

interface ButtonStyleProps {
  readonly variant?: ButtonVariant | undefined;
  readonly size?: ButtonSize | undefined;
  readonly icon?: IconName | undefined;
}

export function Button({
  variant,
  size,
  icon,
  className,
  children,
  type = "button",
  ...rest
}: ButtonStyleProps & ComponentProps<"button">) {
  return (
    <button
      type={type}
      className={buttonClass({ variant, size, className })}
      {...rest}
    >
      {icon ? <Icon name={icon} className="size-4" /> : null}
      {children}
    </button>
  );
}

export function ButtonLink({
  variant,
  size,
  icon,
  className,
  children,
  ...rest
}: ButtonStyleProps & ComponentProps<typeof Link>) {
  return (
    <Link className={buttonClass({ variant, size, className })} {...rest}>
      {icon ? <Icon name={icon} className="size-4" /> : null}
      {children}
    </Link>
  );
}

export function SubmitButton({
  children,
  pendingLabel,
  variant = "primary",
  size = "md",
  className,
  icon,
  disabled = false,
}: {
  readonly children: ReactNode;
  /** Say what is happening, not "Loading". */
  readonly pendingLabel?: string | undefined;
  readonly variant?: ButtonVariant | undefined;
  readonly size?: ButtonSize | undefined;
  readonly className?: string | undefined;
  readonly icon?: IconName | undefined;
  /** Held back until the form is in a postable state. */
  readonly disabled?: boolean | undefined;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending || disabled}
      aria-busy={pending}
      className={buttonClass({ variant, size, className })}
    >
      {pending ? (
        <>
          <Spinner />
          {pendingLabel ?? children}
        </>
      ) : (
        <>
          {icon ? <Icon name={icon} className="size-4" /> : null}
          {children}
        </>
      )}
    </button>
  );
}

/* ------------------------------------------------------------------------ */
/* Inputs                                                                   */
/* ------------------------------------------------------------------------ */

function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p
      id={id}
      role="alert"
      className="flex items-center gap-1.5 text-xs font-medium text-negative-ink"
    >
      <Icon name="alert-triangle" className="size-3.5 shrink-0" />
      {children}
    </p>
  );
}

/**
 * A submit-time error, hidden again as soon as the control is edited.
 *
 * The message describes the value that was *submitted*. Once someone starts
 * fixing the field it is about something that is no longer there — "Enter the
 * last 3-4 digits only" sitting under a box that now reads 4242 tells the
 * person their correct answer is wrong.
 *
 * It comes back if the next submit rejects the new value. Forms clear their
 * error state before calling the action, so even a repeat of the identical
 * message arrives here as a prop change and re-shows.
 */
function useSubmitError(error: string | undefined) {
  const [edited, setEdited] = useState(false);
  useEffect(() => {
    setEdited(false);
  }, [error]);
  // Setting true when already true is a no-op re-render in React, so this is
  // safe to call on every keystroke.
  return { shown: edited ? undefined : error, onEdit: () => setEdited(true) };
}

export function Field({
  label,
  name,
  type = "text",
  required = false,
  defaultValue,
  placeholder,
  error,
  hint,
  autoComplete,
  inputMode,
  icon,
  className,
}: {
  // `| undefined` on each: with exactOptionalPropertyTypes an omitted prop and
  // an explicitly-undefined prop differ, and callers pass `fieldErrors?.x`.
  label: string;
  name: string;
  type?: string | undefined;
  required?: boolean | undefined;
  defaultValue?: string | undefined;
  placeholder?: string | undefined;
  error?: string | undefined;
  hint?: string | undefined;
  autoComplete?: string | undefined;
  inputMode?: ComponentProps<"input">["inputMode"] | undefined;
  icon?: IconName | undefined;
  className?: string | undefined;
}) {
  const id = `field-${name}`;
  const { shown, onEdit } = useSubmitError(error);
  const describedBy = [shown ? `${id}-error` : null, hint ? `${id}-hint` : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-[13px] font-semibold text-ink">
        {label}
        {!required && (
          <span className="ml-1.5 font-normal text-ink-3">optional</span>
        )}
      </label>
      <div className="relative">
        {icon ? (
          <Icon
            name={icon}
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3"
          />
        ) : null}
        <input
          id={id}
          name={name}
          type={type}
          required={required}
          defaultValue={defaultValue}
          placeholder={placeholder}
          autoComplete={autoComplete}
          inputMode={inputMode}
          onChange={onEdit}
          aria-invalid={shown ? true : undefined}
          aria-describedby={describedBy || undefined}
          className={cx(inputClass, icon && "pl-9")}
        />
      </div>
      {shown ? <FieldError id={`${id}-error`}>{shown}</FieldError> : null}
      {hint ? (
        <p id={`${id}-hint`} className="text-xs leading-relaxed text-ink-3">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** A password input with a show/hide toggle. Always required. */
export function PasswordField({
  label,
  name,
  placeholder,
  autoComplete,
  error,
  hint,
  className,
  action,
  value,
  onChange,
}: {
  label: string;
  name: string;
  placeholder?: string | undefined;
  autoComplete?: string | undefined;
  error?: string | undefined;
  hint?: string | undefined;
  className?: string | undefined;
  /** Sits at the right end of the label row — a "Forgot password?" link, say. */
  action?: ReactNode | undefined;
  /** Supply both to drive a live checklist; omit for an uncontrolled field. */
  value?: string | undefined;
  onChange?: ((value: string) => void) | undefined;
}) {
  const [visible, setVisible] = useState(false);
  const id = `field-${name}`;
  const { shown, onEdit } = useSubmitError(error);
  const describedBy = [shown ? `${id}-error` : null, hint ? `${id}-hint` : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="text-[13px] font-semibold text-ink">
          {label}
        </label>
        {action}
      </div>
      <div className="relative">
        <Icon
          name="lock"
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3"
        />
        <input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          required
          placeholder={placeholder}
          autoComplete={autoComplete}
          aria-invalid={shown ? true : undefined}
          aria-describedby={describedBy || undefined}
          // A controlled caller keeps its own onChange; either way the error clears.
          {...(onChange
            ? {
                value: value ?? "",
                onChange: (event: ChangeEvent<HTMLInputElement>) => {
                  onEdit();
                  onChange(event.target.value);
                },
              }
            : { onChange: onEdit })}
          className={cx(inputClass, "pl-9 pr-11")}
        />
        <button
          type="button"
          onClick={() => setVisible((value) => !value)}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          className="absolute right-1.5 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-sunken hover:text-ink"
        >
          <Icon name={visible ? "eye-off" : "eye"} className="size-4" />
        </button>
      </div>
      {shown ? <FieldError id={`${id}-error`}>{shown}</FieldError> : null}
      {hint ? (
        <p id={`${id}-hint`} className="text-xs leading-relaxed text-ink-3">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function Select({
  label,
  error,
  hint,
  className,
  children,
  id,
  ...rest
}: {
  label?: string | undefined;
  error?: string | undefined;
  hint?: string | undefined;
} & ComponentProps<"select">) {
  const selectId = id ?? (rest.name ? `select-${rest.name}` : undefined);
  const { shown, onEdit } = useSubmitError(error);

  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      {label ? (
        <label htmlFor={selectId} className="text-sm font-medium text-ink">
          {label}
        </label>
      ) : null}
      <div className="relative">
        <select
          id={selectId}
          aria-invalid={shown ? true : undefined}
          className={cx(inputClass, "appearance-none pr-9")}
          {...rest}
          // After `rest`, so a caller's own onChange still runs rather than being lost.
          onChange={(event) => {
            onEdit();
            rest.onChange?.(event);
          }}
        >
          {children}
        </select>
        <Icon
          name="chevron-down"
          className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-ink-3"
        />
      </div>
      {shown ? (
        <FieldError id={`${selectId ?? "select"}-error`}>{shown}</FieldError>
      ) : null}
      {hint ? <p className="text-xs leading-relaxed text-ink-3">{hint}</p> : null}
    </div>
  );
}

export function SearchInput({
  name = "q",
  defaultValue,
  placeholder,
  label,
  className,
}: {
  name?: string | undefined;
  defaultValue?: string | undefined;
  placeholder?: string | undefined;
  label: string;
  className?: string | undefined;
}) {
  return (
    <div className={cx("relative", className)}>
      <Icon
        name="search"
        className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-3"
      />
      <input
        type="search"
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        aria-label={label}
        className={cx(inputClass, "h-11 pl-10 pr-4")}
      />
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Feedback                                                                 */
/* ------------------------------------------------------------------------ */

type Tone = "negative" | "warning" | "positive" | "info";

const ALERT: Record<Tone, { box: string; icon: IconName }> = {
  negative: {
    box: "border-negative/20 bg-negative-soft text-negative-ink",
    icon: "alert-triangle",
  },
  warning: {
    box: "border-warning/25 bg-warning-soft text-warning-ink",
    icon: "alert-triangle",
  },
  positive: {
    box: "border-positive/20 bg-positive-soft text-positive-ink",
    icon: "check-circle",
  },
  info: { box: "border-accent/20 bg-accent-soft text-accent-ink", icon: "info" },
};

export function Alert({
  tone = "negative",
  title,
  children,
  action,
  className,
}: {
  tone?: Tone | undefined;
  title?: string | undefined;
  children: ReactNode;
  action?: ReactNode;
  className?: string | undefined;
}) {
  return (
    <div
      role={tone === "negative" ? "alert" : "status"}
      className={cx(
        "flex items-start gap-3 rounded-control border px-3.5 py-2.5 text-sm",
        ALERT[tone].box,
        className,
      )}
    >
      <Icon name={ALERT[tone].icon} className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1 leading-relaxed">
        {title ? <p className="font-semibold">{title}</p> : null}
        <div className={title ? "mt-0.5" : ""}>{children}</div>
      </div>
      {action ? <div className="shrink-0 self-center">{action}</div> : null}
    </div>
  );
}

type BadgeTone = "neutral" | "accent" | "positive" | "warning" | "negative" | "outline";

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: "bg-sunken text-ink-2",
  accent: "bg-accent-soft text-accent-ink",
  positive: "bg-positive-soft text-positive-ink",
  warning: "bg-warning-soft text-warning-ink",
  negative: "bg-negative-soft text-negative-ink",
  outline: "ring-1 ring-inset ring-rule text-ink-2",
};

export function Badge({
  tone = "neutral",
  dot = false,
  className,
  title,
  children,
}: {
  tone?: BadgeTone | undefined;
  dot?: boolean | undefined;
  className?: string | undefined;
  title?: string | undefined;
  children: ReactNode;
}) {
  return (
    <span
      title={title}
      className={cx(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-bold leading-[18px]",
        BADGE_TONES[tone],
        className,
      )}
    >
      {dot ? <span className="size-1.5 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] border border-rule bg-surface-2 px-1.5 font-mono text-[10px] font-medium text-ink-2">
      {children}
    </kbd>
  );
}

/* ------------------------------------------------------------------------ */
/* Layout                                                                   */
/* ------------------------------------------------------------------------ */

export function Card({
  className,
  children,
}: {
  className?: string | undefined;
  children: ReactNode;
}) {
  return <div className={cx("card", className)}>{children}</div>;
}

export function CardHeader({
  title,
  description,
  action,
  icon,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  /** A soft accent disc before the title, for cards that stand alone. */
  icon?: IconName | undefined;
  className?: string | undefined;
}) {
  return (
    <div
      className={cx(
        "flex items-start justify-between gap-4 border-b border-rule px-6 py-4",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        {icon ? (
          <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
            <Icon name={icon} className="size-5" strokeWidth={1.9} />
          </span>
        ) : null}
        <div className="min-w-0">
          <h2 className="text-base font-bold tracking-tight">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-[13px] text-ink-2">{description}</p>
          ) : null}
        </div>
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}

type StatTone = "default" | "accent" | "warning" | "positive" | "negative";

/** The icon disc: a soft field with the icon in the tone's own colour. */
const STAT_TONES: Record<StatTone, string> = {
  default: "bg-sunken text-ink-2",
  accent: "bg-accent-soft text-accent",
  warning: "bg-warning-soft text-warning",
  positive: "bg-positive-soft text-positive",
  negative: "bg-negative-soft text-negative",
};

const STAT_DOTS: Record<StatTone | "neutral", string> = {
  default: "bg-ink-3",
  neutral: "bg-ink-3",
  accent: "bg-accent",
  warning: "bg-warning",
  positive: "bg-positive",
  negative: "bg-negative",
};

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = "default",
  dot,
  href,
  trend,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: IconName | undefined;
  tone?: StatTone | undefined;
  /** A small coloured dot before the label, the way status stats read. */
  dot?: StatTone | "neutral" | undefined;
  href?: string | undefined;
  /** A short change line under the value, e.g. "+4 this week". */
  trend?: { label: string; tone: "positive" | "negative" | "neutral" } | undefined;
}) {
  const body = (
    <div className="flex h-full items-start gap-4">
      {icon ? (
        <span className={cx("inline-flex size-12 shrink-0 items-center justify-center rounded-full", STAT_TONES[tone])}>
          <Icon name={icon} className="size-[22px]" strokeWidth={1.9} />
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-[15px] font-medium text-ink-2">
          {dot ? <span className={cx("size-2 shrink-0 rounded-full", STAT_DOTS[dot])} /> : null}
          <span className="truncate">{label}</span>
        </p>
        <p className="figure mt-1.5 text-[2rem] font-bold leading-none tracking-[-0.03em]">{value}</p>
        {trend ? (
          <p
            className={cx(
              "mt-2 flex items-center gap-1 text-xs font-semibold",
              trend.tone === "positive" ? "text-positive-ink" : trend.tone === "negative" ? "text-negative-ink" : "text-ink-3",
            )}
          >
            {trend.tone !== "neutral" ? (
              <Icon name={trend.tone === "positive" ? "arrow-up-right" : "arrow-down-left"} className="size-3.5" />
            ) : null}
            {trend.label}
          </p>
        ) : hint ? (
          <div className="mt-2 text-xs leading-relaxed text-ink-3">{hint}</div>
        ) : null}
      </div>
      {href ? <Icon name="chevron-right" className="mt-1 size-4 shrink-0 text-ink-3" /> : null}
    </div>
  );

  const frame = "card block p-5 transition-[transform,box-shadow] duration-200";
  return href ? (
    <Link href={href} className={cx(frame, "hover:-translate-y-0.5 hover:shadow-card-hover")}>
      {body}
    </Link>
  ) : (
    <div className={frame}>{body}</div>
  );
}

export function Segmented({
  label,
  items,
}: {
  label: string;
  items: ReadonlyArray<{ href: string; label: string; active: boolean }>;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex h-10 items-center gap-0.5 rounded-xl border border-rule bg-sunken p-1"
    >
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={item.active ? "true" : undefined}
          className={cx(
            "inline-flex h-full items-center rounded-lg px-3.5 text-[13px] font-semibold transition-all",
            item.active
              ? "bg-surface text-accent-ink shadow-xs"
              : "text-ink-2 hover:text-ink",
          )}
        >
          {item.label}
        </Link>
      ))}
    </div>
  );
}

/** A screen heading with its context line. Used at the top of every page. */
export function PageHeader({
  eyebrow,
  title,
  context,
  action,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  context?: ReactNode;
  action?: ReactNode;
  className?: string | undefined;
}) {
  return (
    <div
      className={cx("flex flex-wrap items-end justify-between gap-4", className)}
    >
      <div className="min-w-0">
        {eyebrow ? (
          <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-accent">{eyebrow}</div>
        ) : null}
        <h1 className="display text-[1.75rem] text-ink">{title}</h1>
        {context ? <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-2">{context}</p> : null}
      </div>
      {action ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>
      ) : null}
    </div>
  );
}

export function EmptyState({
  icon = "inbox",
  title,
  body,
  action,
  secondary,
  className,
}: {
  icon?: IconName | undefined;
  title: string;
  body: string;
  /** The main thing to do next. */
  action?: ReactNode;
  /** An alternative, shown under an "Or" divider. */
  secondary?: ReactNode;
  className?: string | undefined;
}) {
  return (
    <div className={cx("flex flex-col items-center gap-3 px-6 py-16 text-center", className)}>
      <span className="inline-flex size-24 items-center justify-center rounded-full bg-accent-soft/70 text-accent">
        <Icon name={icon} className="size-11" strokeWidth={1.25} />
      </span>
      <h2 className="display mt-2 text-[1.75rem]">{title}</h2>
      <p className="max-w-md text-[15px] leading-relaxed text-ink-2">{body}</p>
      {action || secondary ? (
        <div className="mt-4 flex w-full max-w-md flex-col items-stretch gap-3 [&>a]:w-full [&>button]:w-full">
          {action}
          {secondary ? (
            <>
              <div className="flex items-center gap-4 text-xs font-medium text-ink-3">
                <span className="h-px flex-1 bg-ink-3/40" />
                Or
                <span className="h-px flex-1 bg-ink-3/40" />
              </div>
              {secondary}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Modal                                                                    */
/* ------------------------------------------------------------------------ */

const MODAL_WIDTHS = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
} as const;

export function Modal({
  open,
  onClose,
  title,
  description,
  size = "md",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string | undefined;
  size?: keyof typeof MODAL_WIDTHS | undefined;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const titleId = `modal-${title.replace(/\s+/g, "-").toLowerCase()}`;

  // Portalled to <body>: a dialog must never be boxed in by whatever page
  // wrapper happens to be transformed or animating around its trigger.
  return (
    <Portal>
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#0c1030]/55 px-4 py-[8vh] backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
        className={cx("card w-full shadow-pop animate-pop-in", MODAL_WIDTHS[size])}
      >
        <div className="flex items-start justify-between gap-4 border-b border-rule px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-bold tracking-tight">
              {title}
            </h2>
            {description ? (
              <p className="mt-0.5 text-[13px] leading-relaxed text-ink-2">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1.5 -mt-1 inline-flex size-8 shrink-0 items-center justify-center rounded-control text-ink-3 transition-colors hover:bg-sunken hover:text-ink"
          >
            <Icon name="x" />
          </button>
        </div>
        {children}
      </div>
    </div>
    </Portal>
  );
}

/** The action strip at the foot of a modal form. Place it inside the form. */
export function ModalFooter({
  children,
  note,
}: {
  children: ReactNode;
  note?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-end gap-2 rounded-b-card border-t border-rule bg-surface-2 px-5 py-3">
      {note ? <div className="mr-auto text-sm text-ink-3">{note}</div> : null}
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Identity                                                                 */
/* ------------------------------------------------------------------------ */

const AVATAR_HUES = [
  "bg-gradient-to-br from-blue-500 to-indigo-600",
  "bg-gradient-to-br from-sky-500 to-blue-600",
  "bg-gradient-to-br from-emerald-500 to-teal-600",
  "bg-gradient-to-br from-amber-500 to-orange-500",
  "bg-gradient-to-br from-rose-500 to-pink-600",
  "bg-gradient-to-br from-cyan-500 to-blue-500",
] as const;

const AVATAR_SIZES = {
  sm: "size-6 text-[10px]",
  md: "size-8 text-xs",
  lg: "size-10 text-sm",
  xl: "size-14 text-lg",
} as const;

export function Avatar({
  name,
  size = "md",
  className,
  src,
}: {
  name: string;
  size?: keyof typeof AVATAR_SIZES | undefined;
  className?: string | undefined;
  /** A logo or photo; falls back to initials when absent. */
  src?: string | null | undefined;
}) {
  if (src) {
    return (
      <img
        src={src}
        alt=""
        aria-hidden="true"
        className={cx(
          "shrink-0 rounded-full bg-surface object-cover ring-1 ring-rule",
          AVATAR_SIZES[size].split(" ")[0],
          className,
        )}
      />
    );
  }

  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?";

  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const hue = AVATAR_HUES[hash % AVATAR_HUES.length];

  return (
    <span
      aria-hidden="true"
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white",
        hue,
        AVATAR_SIZES[size],
        className,
      )}
    >
      {initials}
    </span>
  );
}

/* ------------------------------------------------------------------------ */
/* Ledger primitives                                                        */
/* ------------------------------------------------------------------------ */

/**
 * Confidence as a gutter rail rather than a badge on every row.
 *
 * A chip on all twenty rows is twenty pieces of noise to read past. A hairline
 * in the gutter disappears when the work is clean and catches the eye when it
 * is not — which is exactly the scan an accountant is doing.
 */
const RAIL: Record<string, string> = {
  CERTAIN: "bg-transparent",
  HIGH: "bg-transparent",
  MEDIUM: "bg-warning",
  LOW: "bg-negative",
};

const RAIL_TITLE: Record<string, string> = {
  CERTAIN: "Coded by rule — safe to accept",
  HIGH: "High confidence",
  MEDIUM: "Worth a check",
  LOW: "Needs review",
};

export function ConfidenceRail({ level }: { level: string | null }) {
  if (!level) return null;
  const needsAttention = level === "MEDIUM" || level === "LOW";

  return (
    <span
      aria-label={needsAttention ? RAIL_TITLE[level] : undefined}
      title={RAIL_TITLE[level] ?? level}
      className={`absolute bottom-2 left-0 top-2 w-[3px] rounded-full ${RAIL[level] ?? "bg-transparent"}`}
    />
  );
}

/** For places where the level must be readable as text, not just as a rail. */
export function ConfidenceLabel({ level }: { level: string | null }) {
  if (!level) return null;
  const tone: Record<string, BadgeTone> = {
    CERTAIN: "neutral",
    HIGH: "neutral",
    MEDIUM: "warning",
    LOW: "negative",
  };
  const label: Record<string, string> = {
    CERTAIN: "By rule",
    HIGH: "Confident",
    MEDIUM: "Check",
    LOW: "Review",
  };
  return <Badge tone={tone[level] ?? "neutral"}>{label[level] ?? level}</Badge>;
}

/**
 * An amount.
 *
 * Tabular, right-aligned, negative in red — never the accent, which means
 * "interactive" here.
 */
export function Money({
  cents,
  className = "",
  emphasis = false,
}: {
  cents: number;
  className?: string;
  emphasis?: boolean;
}) {
  const negative = cents < 0;
  const magnitude = Math.abs(cents);
  const whole = Math.trunc(magnitude / 100).toLocaleString("en-AU");
  const frac = (magnitude % 100).toString().padStart(2, "0");

  return (
    <span
      className={`figure ${negative ? "text-negative" : "text-ink"} ${
        emphasis ? "text-[15px] font-semibold" : ""
      } ${className}`}
    >
      {negative ? "−" : ""}${whole}.{frac}
    </span>
  );
}

export function AccountCode({ code }: { code: string }) {
  return <span className="code text-ink-3">{code}</span>;
}
