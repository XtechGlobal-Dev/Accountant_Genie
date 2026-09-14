"use client";

/**
 * The sign-up form, in three steps.
 *
 * Still one form and one submit: every step's fields stay in the document,
 * the ones not on screen simply hidden, so the server action receives the
 * whole thing at once and validates it once. Moving forward checks the
 * fields on screen with the browser's own validity, so nothing required can
 * be left behind in a hidden step.
 *
 * Grouped, because the groups are real: who you are, where you practise, and
 * whether you are registered. Only the registration answer changes the form —
 * saying yes reveals the two fields that evidence it, because a claim without
 * a body and a number is a permission switched on with nothing behind it.
 */

import { useRef, useState, useTransition } from "react";
import { signUp, type AuthFormResult } from "@/server/modules/auth/actions";
import { Icon } from "@/ui/icons";
import { Alert, Button, Field, PasswordField, Select, cx } from "@/ui/primitives";

const STATES = [
  ["NSW", "New South Wales"],
  ["VIC", "Victoria"],
  ["QLD", "Queensland"],
  ["WA", "Western Australia"],
  ["SA", "South Australia"],
  ["TAS", "Tasmania"],
  ["ACT", "Australian Capital Territory"],
  ["NT", "Northern Territory"],
] as const;

const BODIES = [
  ["CA_ANZ", "Chartered Accountants Australia and New Zealand (CA ANZ)"],
  ["CPA_AUSTRALIA", "CPA Australia"],
  ["IPA", "Institute of Public Accountants (IPA)"],
  ["ATMA", "Association of Taxation and Management Accountants (ATMA)"],
  ["TPB", "Tax Practitioners Board (TPB)"],
  ["NTAA", "National Tax and Accountants' Association (NTAA)"],
  ["OTHER", "Other"],
] as const;

const HEARD = [
  ["SOCIAL_MEDIA", "Social media"],
  ["BLOG_OR_ARTICLE", "Blog or article"],
  ["COMMUNITY_EVENTS", "Community events"],
  ["FRIENDS_AND_COLLEAGUES", "Friends and colleagues"],
  ["OTHER", "Other"],
] as const;

const STEPS = [
  { title: "Your details", blurb: "Who is opening the account." },
  { title: "Your practice", blurb: "The firm these books belong to." },
  { title: "Registration", blurb: "Whether you can sign off tax rules." },
] as const;

/** Which step each field lives on, so a server error opens the right one. */
const FIELD_STEP: Record<string, number> = {
  name: 0,
  email: 0,
  phone: 0,
  password: 0,
  firmName: 1,
  state: 1,
  professionalTitle: 1,
  howHeard: 1,
  isTaxAgent: 2,
  professionalBody: 2,
  agentNumber: 2,
};

const FIELD_LABELS: Record<string, string> = {
  name: "Name",
  email: "Email",
  phone: "Phone",
  password: "Password",
  firmName: "Firm name",
  state: "State",
  professionalTitle: "Title",
  professionalBody: "Accounting body",
  agentNumber: "Registration number",
};

function Stepper({ current }: { current: number }) {
  return (
    <ol className="flex items-center gap-2" aria-label="Progress">
      {STEPS.map((step, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li key={step.title} className={cx("flex items-center gap-2", index < STEPS.length - 1 && "flex-1")}>
            <span
              aria-current={active ? "step" : undefined}
              className={cx(
                "inline-flex size-7 shrink-0 items-center justify-center rounded-full text-[12px] font-bold transition-colors",
                done ? "bg-accent text-white" : active ? "bg-accent-soft text-accent-ink ring-2 ring-accent" : "bg-sunken text-ink-3",
              )}
            >
              {done ? <Icon name="check" className="size-3.5" strokeWidth={3} /> : index + 1}
            </span>
            <span className={cx("hidden whitespace-nowrap text-[13px] font-semibold sm:block", active ? "text-ink" : "text-ink-3")}>
              {step.title}
            </span>
            {index < STEPS.length - 1 ? <span className={cx("h-px flex-1", done ? "bg-accent" : "bg-rule")} /> : null}
          </li>
        );
      })}
    </ol>
  );
}

const Two = ({ children }: { children: React.ReactNode }) => <div className="grid gap-3 sm:grid-cols-2">{children}</div>;

export function SignUpForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [step, setStep] = useState(0);
  const [isTaxAgent, setIsTaxAgent] = useState<boolean | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const last = step === STEPS.length - 1;

  /** The browser's own checks, on the fields of the step on screen only. */
  function stepIsValid(): boolean {
    const panel = formRef.current?.querySelector<HTMLElement>(`[data-step="${step}"]`);
    if (!panel) return true;
    const controls = Array.from(panel.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select"));
    for (const control of controls) {
      if (!control.checkValidity()) {
        control.reportValidity();
        return false;
      }
    }
    return true;
  }

  function next() {
    setError(null);
    if (stepIsValid()) setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function submit(formData: FormData) {
    setError(null);
    setNote(null);
    startTransition(async () => {
      const result: AuthFormResult = await signUp(formData);
      if (!result.ok) {
        const label = result.field ? FIELD_LABELS[result.field] : undefined;
        setError(label ? `${label}: ${result.error}` : result.error);
        const target = result.field ? FIELD_STEP[result.field] : undefined;
        if (target !== undefined) setStep(target);
      } else if (result.note) {
        setNote(result.note);
      }
    });
  }

  return (
    <form
      ref={formRef}
      action={submit}
      className="flex flex-col gap-5"
      onKeyDown={(event) => {
        // Enter on an earlier step advances rather than submitting the lot.
        if (event.key === "Enter" && !last && (event.target as HTMLElement).tagName !== "TEXTAREA") {
          event.preventDefault();
          next();
        }
      }}
    >
      <Stepper current={step} />

      <div>
        <h2 className="text-base font-bold tracking-tight">{STEPS[step].title}</h2>
        <p className="mt-0.5 text-[13px] text-ink-2">{STEPS[step].blurb}</p>
      </div>

      {error ? <Alert tone="negative">{error}</Alert> : null}
      {note ? <Alert tone="info">{note}</Alert> : null}

      {/* Step 1 — who you are */}
      <div data-step="0" hidden={step !== 0} className="flex flex-col gap-3">
        <Two>
          <Field label="Your name" name="name" required autoComplete="name" />
          <Field label="Email" name="email" type="email" required autoComplete="email" />
        </Two>
        <Two>
          <Field label="Phone" name="phone" type="tel" autoComplete="tel" placeholder="04XX XXX XXX" />
          <PasswordField label="Password" name="password" autoComplete="new-password" placeholder="At least 10 characters" />
        </Two>
      </div>

      {/* Step 2 — where you practise */}
      <div data-step="1" hidden={step !== 1} className="flex flex-col gap-3">
        <Two>
          <Field label="Firm name" name="firmName" required placeholder="e.g. Meridian Accounting" />
          <Select label="State" name="state" required defaultValue="">
            <option value="" disabled>
              Select a state
            </option>
            {STATES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Two>
        <Two>
          <Field label="Your title" name="professionalTitle" placeholder="e.g. Principal" />
          <Select label="How did you hear about us?" name="howHeard" defaultValue="">
            <option value="">Prefer not to say</option>
            {HEARD.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Two>
      </div>

      {/* Step 3 — registration */}
      <div data-step="2" hidden={step !== 2} className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-2 border-0 p-0">
          <legend className="text-[13px] font-semibold text-ink">
            Are you a registered tax agent, or a member of a professional accounting body?
          </legend>
          <p className="text-xs leading-relaxed text-ink-3">
            Preparing BAS for a fee is regulated in Australia. Only a registered practitioner can sign off a tax rule in Accountant Genie.
          </p>
          {/* A real radio group, so it is keyboard reachable and announced as a
              group — the visual is a pair of buttons, the semantics are not. */}
          <div className="mt-1 grid grid-cols-2 gap-2">
            {[
              [true, "Yes"],
              [false, "No"],
            ].map(([value, label]) => {
              const selected = isTaxAgent === value;
              return (
                <label
                  key={String(label)}
                  className={cx(
                    "flex cursor-pointer items-center justify-center rounded-control border px-3 py-2.5 text-sm font-medium transition-colors",
                    selected ? "border-accent bg-accent-soft text-ink" : "border-rule bg-surface text-ink-2 hover:border-rule-strong",
                    "focus-within:ring-4 focus-within:ring-accent/15",
                  )}
                >
                  <input
                    type="radio"
                    name="isTaxAgent"
                    value={value ? "yes" : "no"}
                    checked={selected}
                    onChange={() => setIsTaxAgent(value as boolean)}
                    className="sr-only"
                    required
                  />
                  {label}
                </label>
              );
            })}
          </div>
        </fieldset>

        {isTaxAgent ? (
          <Two>
            <Select label="Accounting body" name="professionalBody" required defaultValue="">
              <option value="" disabled>
                Select an accounting body
              </option>
              {BODIES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
            <Field label="Registration number" name="agentNumber" required placeholder="e.g. 25123456" hint="Your TPB registration or membership number." />
          </Two>
        ) : null}
      </div>

      <div className="mt-1 flex items-center justify-between gap-3">
        {step > 0 ? (
          <Button type="button" variant="ghost" icon="arrow-left" onClick={() => setStep((s) => s - 1)} disabled={pending}>
            Back
          </Button>
        ) : (
          <span />
        )}
        {last ? (
          <Button type="submit" size="lg" className="min-w-40" disabled={pending}>
            {pending ? "Creating…" : "Create firm"}
          </Button>
        ) : (
          <Button type="button" size="lg" className="min-w-40" onClick={next}>
            Continue
            <Icon name="arrow-right" />
          </Button>
        )}
      </div>
    </form>
  );
}
