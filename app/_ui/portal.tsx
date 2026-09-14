"use client";

/**
 * Renders children at the end of <body>.
 *
 * Overlays use `position: fixed`, and a fixed element is positioned against
 * the nearest ancestor with a transform — including, in Chromium, one whose
 * transform *animation* has finished but still fills. The page wrapper
 * animates in with a transform, so a dialog rendered inline would be boxed
 * into the page content. Portalling to <body> puts every overlay outside any
 * such ancestor, whatever the page around it does.
 */

import { useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

const subscribe = () => () => {};

export function Portal({ children }: { readonly children: ReactNode }) {
  // Server: nothing (no document). Client, after hydration: <body>.
  const target = useSyncExternalStore(
    subscribe,
    () => document.body,
    () => null,
  );
  return target ? createPortal(children, target) : null;
}
