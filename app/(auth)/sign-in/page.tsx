import type { Metadata } from "next";
import Link from "next/link";
import { signIn } from "@/server/modules/auth/actions";
import { googleConfigured } from "@/server/modules/auth/google";
import { AuthForm } from "@/features/auth/components/auth-form";
import { Alert, Field, PasswordField } from "@/ui/primitives";
import { buttonClass } from "@/ui/styles";

export const metadata: Metadata = { title: "Sign in" };

/** The Google "G" in its four colours, as the sign-in button carries it. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-[18px]">
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.7-2.4 3.6v3h3.8c2.3-2.1 3.6-5.2 3.6-8.8z" />
      <path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.8-3c-1.1.7-2.4 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.4v3.1C3.4 21.3 7.4 24 12 24z" />
      <path fill="#FBBC05" d="M5.3 14.3c-.2-.7-.4-1.5-.4-2.3s.1-1.6.4-2.3V6.6H1.4C.5 8.2 0 10.1 0 12s.5 3.8 1.4 5.4l3.9-3.1z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4C17.9 1.2 15.2 0 12 0 7.4 0 3.4 2.7 1.4 6.6l3.9 3.1c.9-2.9 3.6-4.9 6.7-4.9z" />
    </svg>
  );
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; expired?: string }>;
}) {
  const { error, expired } = await searchParams;
  const google = googleConfigured();

  return (
    <>
      <div className="flex flex-col items-center text-center">
        <h1 className="display text-[1.75rem]">Welcome back</h1>
        <p className="mt-1.5 text-sm text-ink-2">Sign in to your Accountant Genie account.</p>
      </div>

      {error ? (
        <div className="mt-6">
          <Alert tone="negative">{error}</Alert>
        </div>
      ) : expired ? (
        <div className="mt-6">
          <Alert tone="info">Your session has ended. Sign in again to continue.</Alert>
        </div>
      ) : null}

      <div className="mt-7">
        <AuthForm action={signIn} submitLabel="Sign in" pendingLabel="Checking…">
          <Field label="Email" name="email" type="email" required autoComplete="email" icon="mail" placeholder="you@yourfirm.com.au" />
          <PasswordField
            label="Password"
            name="password"
            autoComplete="current-password"
            placeholder="Enter your password"
            action={
              <Link href="/forgot" className="text-[13px] font-semibold text-accent hover:text-accent-ink">
                Forgot password?
              </Link>
            }
          />
        </AuthForm>
      </div>

      {google ? (
        <>
          <div className="my-6 flex items-center gap-3 text-xs text-ink-3">
            <span className="h-px flex-1 bg-rule" />
            or continue with
            <span className="h-px flex-1 bg-rule" />
          </div>
          <a href="/api/auth/google" className={buttonClass({ variant: "secondary", size: "lg", className: "w-full" })}>
            <GoogleMark />
            Google
          </a>
        </>
      ) : null}

      <p className="mt-8 text-center text-[13px] text-ink-2">
        New to Accountant Genie?{" "}
        <Link href="/sign-up" className="font-bold text-accent hover:text-accent-ink">
          Create a firm
        </Link>
      </p>
      <p className="mt-4 text-center text-xs text-ink-3">A six-digit code follows by email after your password.</p>
    </>
  );
}
