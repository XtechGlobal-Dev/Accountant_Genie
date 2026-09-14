import type { Metadata } from "next";
import Link from "next/link";
import { verifyCode } from "@/server/modules/auth/actions";
import { AuthForm } from "@/features/auth/components/auth-form";
import { OtpInput } from "@/features/auth/components/otp-input";
import { ResendButton } from "@/features/auth/components/resend-button";
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
      <div className="mt-8">
        <AuthForm action={verifyCode} submitLabel="Verify Code" pendingLabel="Verifying…">
          <OtpInput />
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
