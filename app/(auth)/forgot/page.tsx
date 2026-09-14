import type { Metadata } from "next";
import Link from "next/link";
import { requestPasswordReset } from "@/server/modules/auth/actions";
import { AuthForm } from "@/features/auth/components/auth-form";
import { Field } from "@/ui/primitives";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPage() {
  return (
    <>
      <h1 className="display text-[1.75rem]">Reset your password</h1>
      <p className="mt-2 text-sm text-ink-2">
        If the email is registered, a six-digit code is sent to it. The answer looks the same
        either way.
      </p>
      <div className="mt-6">
        <AuthForm action={requestPasswordReset} submitLabel="Send code" pendingLabel="Sending…">
          <Field label="Email" name="email" type="email" required autoComplete="email" />
        </AuthForm>
      </div>
      <p className="mt-5 text-sm">
        <Link href="/sign-in" className="font-medium text-ink-2 hover:text-accent">
          Back to sign in
        </Link>
      </p>
    </>
  );
}
