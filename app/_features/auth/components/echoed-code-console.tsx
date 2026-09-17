"use client";

import { useEffect } from "react";

/**
 * Writes the code to the browser console.
 *
 * A `<script>` rendered by a component only runs on a full document load —
 * React inserts it into the DOM on a client-side navigation, and a script
 * inserted that way never executes. Sign-in reaches this screen by navigation,
 * which is exactly the path that would have silently done nothing.
 *
 * The console, not the page, on purpose: both are readable by whoever is at
 * the keyboard, but the console does not travel into a screenshot or a screen
 * share the way rendered text does.
 */
export function EchoedCodeConsole({ code }: { code: string }) {
  useEffect(() => {
    console.warn(
      `%c Accountant Genie %c sign-in code: ${code}\n` +
        "MAIL_DEBUG_ECHO_CODE is on, so anyone who reaches this screen can read the code. " +
        "Turn it off once email is configured.",
      "background:#2563eb;color:#fff;padding:2px 6px;border-radius:4px;font-weight:600",
      "",
    );
  }, [code]);

  return null;
}
