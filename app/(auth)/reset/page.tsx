import type { Metadata } from "next";
import Link from "next/link";
import { resetPassword } from "@/server/modules/auth/actions";
import { AuthForm } from "@/features/auth/components/auth-form";
import { ResendButton } from "@/features/auth/components/resend-button";
import { EchoedCode } from "@/features/auth/components/echoed-code";
import { Alert, Field, PasswordField } from "@/ui/primitives";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPage({
  searchParams,
}: {
  searchParams: Promise<{ console?: string }>;
}) {
  const { console: consoleOnly } = await searchParams;
  return (
    <>
      <h1 className="display text-[1.75rem]">Choose a new password</h1>
      <p className="mt-2 text-sm text-ink-2">Enter the code from your email and a new password. Other browsers are signed out.</p>
      {consoleOnly === "1" ? (
        <div className="mt-4">
          <Alert tone="info" title="No email provider is configured">
            The code was written to the server log — look for a line starting with “[mail →”.
          </Alert>
        </div>
      ) : null}
      <EchoedCode />
      <div className="mt-6">
        <AuthForm action={resetPassword} submitLabel="Set password" pendingLabel="Saving…">
          <Field label="Verification code" name="code" required inputMode="numeric" autoComplete="one-time-code" placeholder="000000" />
          <PasswordField label="New password" name="password" autoComplete="new-password" hint="At least 10 characters." />
        </AuthForm>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <ResendButton />
        <Link href="/sign-in" className="text-sm font-medium text-ink-2 hover:text-accent">
          Back to sign in
        </Link>
      </div>
    </>
  );
}
