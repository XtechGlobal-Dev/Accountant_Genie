import type { Metadata } from "next";
import Link from "next/link";
import { SignUpForm } from "@/features/auth/components/sign-up-fields";

export const metadata: Metadata = { title: "Create a firm" };

/** Three short steps on a slightly wider card, so no step scrolls. */
export default function SignUpPage() {
  return (
    <div data-wide>
      <div className="text-center">
        <h1 className="display text-[1.75rem]">Create your firm</h1>
        <p className="mt-1.5 text-sm text-ink-2">You become the owner. Add your team afterwards.</p>
      </div>
      <div className="mt-6">
        <SignUpForm />
      </div>
      <p className="mt-6 text-center text-[13px] text-ink-2">
        Already have an account?{" "}
        <Link href="/sign-in" className="font-bold text-accent hover:text-accent-ink">
          Sign in
        </Link>
      </p>
    </div>
  );
}
