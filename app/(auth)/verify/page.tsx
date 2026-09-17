import type { Metadata } from "next";
import Link from "next/link";
import { verifyCode } from "@/server/modules/auth/actions";
import { AuthForm } from "@/features/auth/components/auth-form";
import { OtpInput } from "@/features/auth/components/otp-input";
import { ResendButton } from "@/features/auth/components/resend-button";
import { EchoedCode } from "@/features/auth/components/echoed-code";
import { Alert } from "@/ui/primitives";

export const metadata: Metadata = { title: "Verify code" };

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ console?: string }>;
}) {
  const { console: consoleOnly } = await searchParams;
  return (
    <div className="text-center">
      <h1 className="display text-[2rem]">Verify your code</h1>
      <p className="mt-2 text-sm text-ink-2">Enter the six-digit code we sent to your email.</p>
      {consoleOnly === "1" ? (
        <div className="mt-4 text-left">
          <Alert tone="info" title="No email provider is configured">
            The code was written to the server log — look for a line starting with “[mail →”.
          </Alert>
        </div>
      ) : null}
      <EchoedCode />
      <div className="mt-8">
        <AuthForm action={verifyCode} submitLabel="Verify Code" pendingLabel="Verifying…">
          <OtpInput />
          {/*
            Opt-in, and deliberately not ticked by default: an accountant signs
            in from client sites and shared machines, and the safe answer for a
            browser we know nothing about is to ask again.
          */}
          <label className="mx-auto flex max-w-sm cursor-pointer items-start gap-2.5 rounded-xl border border-rule bg-surface-2 px-3.5 py-3 text-left transition-colors hover:border-rule-strong">
            <input
              type="checkbox"
              name="remember"
              value="yes"
              className="mt-0.5 size-4 shrink-0 accent-accent"
            />
            <span className="text-[13px] leading-snug text-ink-2">
              <span className="block font-semibold text-ink">Remember this device for 30 days</span>
              Skip this code next time on this browser. Your password is still asked for. Only on a device you own.
            </span>
          </label>
        </AuthForm>
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <ResendButton />
        <Link href="/sign-in" className="text-sm font-medium text-ink-2 hover:text-accent">
          Start again
        </Link>
      </div>
    </div>
  );
}
