import { peekEchoedCode } from "@/server/modules/auth/service";
import { EchoedCodeConsole } from "./echoed-code-console";
import { Alert } from "@/ui/primitives";

/**
 * Shows the one-time code to the person who just asked for it — but only in an
 * environment that has no way to email it.
 *
 * The server is the only thing that decides whether this renders:
 * `peekEchoedCode` returns null unless `MAIL_DEBUG_ECHO_CODE=1` is set AND the
 * message was merely logged rather than sent. Configure a mail provider and
 * this disappears without anyone editing a page.
 *
 * The code goes to the browser console rather than onto the screen. Both are
 * equally readable to whoever is at the keyboard, but the console does not end
 * up in a screen share, a screenshot or a support ticket by accident. Writing
 * it is a client component's job — see the note in `echoed-code-console.tsx`.
 *
 * The banner above it is the point of the whole thing: an environment running
 * like this has a password for a front door and nothing behind it, and that
 * should be impossible to miss while it is true.
 */
export async function EchoedCode() {
  const code = await peekEchoedCode();
  if (!code) return null;

  return (
    <>
      <div className="mt-4 text-left">
        <Alert tone="warning" title="Your code is in the browser console">
          Open DevTools (F12) → Console. This environment cannot send email, so the code is handed to
          the browser instead — which means the six-digit step is protecting nothing right now. It stops
          on its own once a mail provider is configured.
        </Alert>
      </div>
      <EchoedCodeConsole code={code} />
    </>
  );
}
