import type { Metadata } from "next";
import { Geist, Geist_Mono, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

// Self-hosted through next/font: the browser never calls Google, which keeps
// the CSP tight and the first paint free of a cross-origin round trip.
//
// Plus Jakarta Sans carries the interface and the headings. It has no tabular
// numerals, so figures are set in Geist (see `.figure` in globals.css) and
// account codes in Geist Mono.
const sans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-jakarta",
  display: "swap",
});

const figures = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
  display: "swap",
});

const mono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Accountant Genie",
    template: "%s · Accountant Genie",
  },
  description:
    "AI reconciliation and Australian tax reporting on a double-entry ledger.",
  // The application tier holds client financial data and must never be indexed.
  robots: { index: false, follow: false },
};

// Applies the saved appearance before first paint so a dark preference never
// flashes light. Light is the default; "system" follows the OS.
//
// Deliberately a plain <script> rather than next/script. `beforeInteractive`
// is documented as not blocking hydration and is hoisted into <head> wherever
// it sits, so it buys nothing here — while rendering a <Script> inside an
// explicit <head> makes React warn that it "encountered a script tag while
// rendering", because the element ends up in the client tree. An inline
// script written straight into the HTML runs during parse, which is the one
// property a flash-of-wrong-theme fix actually needs.
const THEME_SCRIPT =
  '(function(){try{var t=localStorage.getItem("ledgerly-theme");' +
  'if(t==="system"){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}' +
  'if(t!=="dark"){t="light"}document.documentElement.dataset.theme=t}catch(e){}})();';

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en-AU"
      className={`${sans.variable} ${figures.variable} ${mono.variable}`}
      data-theme="light"
      suppressHydrationWarning
    >
      <head>
        <script id="ledgerly-theme" dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      {/*
        Browser extensions write their own attributes onto <body> before React
        hydrates — ColorZilla's `cz-shortcut-listen`, password managers, and
        others — and React reports each as a hydration mismatch it cannot
        patch. Suppression is shallow: it covers this element's own attributes
        and nothing inside it, so a real mismatch in the app still surfaces.
      */}
      <body className="bg-ground font-sans text-ink" suppressHydrationWarning>
        {/* Keyboard users land here first and can jump the sidebar. */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-full focus:bg-surface focus:px-4 focus:py-2 focus:shadow-pop"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
