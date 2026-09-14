import type { Metadata } from "next";
import Link from "next/link";
import { Icon, type IconName } from "@/ui/icons";
import { buttonClass } from "@/ui/styles";
import { Card, CardHeader, Kbd, PageHeader } from "@/ui/primitives";

export const metadata: Metadata = { title: "Help" };

/**
 * In-app documentation: how the product is meant to be used, in the order
 * a firm uses it. Static on purpose — it describes behaviour, not data.
 */

const WORKFLOW: ReadonlyArray<{ icon: IconName; title: string; body: string; href: string; cta: string }> = [
  {
    icon: "user-plus",
    title: "1. Add the client",
    body: "Business name, ABN, entity type, GST registration and basis, BAS cycle. Partners and their shares for partnerships. Opening balances if the books are moving from elsewhere.",
    href: "/clients?new=1",
    cta: "Add a client",
  },
  {
    icon: "landmark",
    title: "2. Bring in the bank data",
    body: "Add the client's bank accounts, then upload a CSV or PDF statement — or request a live feed and let the client authorise it. Rows are normalised and duplicates dropped by fingerprint, so re-uploading is safe.",
    href: "/clients",
    cta: "Open a client",
  },
  {
    icon: "sparkles",
    title: "3. Reconcile",
    body: "The engine codes each transaction: Coding Memory first, then deterministic rules, then AI with a validation gate. Anything uncertain is sent to review rather than guessed. Nothing reaches the ledger until a person accepts it.",
    href: "/memory",
    cta: "See Coding Memory",
  },
  {
    icon: "list-checks",
    title: "4. Review the exceptions",
    body: "Work the Transactions screen with the keyboard: accept what is right, recode what is not, exclude transfers. Accepting posts a balanced journal with the GST snapshot on every line.",
    href: "/clients",
    cta: "Review transactions",
  },
  {
    icon: "bar-chart",
    title: "5. Report",
    body: "Profit & Loss, Balance Sheet, Trial Balance, General Ledger, BAS, TPAR, depreciation and EOFY all derive from the one ledger. Every figure drills down to the journal lines behind it. Print, save as PDF, or export CSV.",
    href: "/clients",
    cta: "Open reports",
  },
  {
    icon: "scale",
    title: "6. Verify tax rules",
    body: "Thresholds and mappings that change with legislation — instant asset write-off, car limit, BAS W1/W2 accounts — are versioned and applied only once the registered tax agent verifies them.",
    href: "/settings/tax-rules",
    cta: "Tax rules",
  },
];

const SHORTCUTS: ReadonlyArray<{ keys: string[]; does: string; where: string }> = [
  { keys: ["Ctrl", "K"], does: "Open the Command Bar", where: "Everywhere" },
  { keys: ["C"], does: "Open the Command Bar", where: "Everywhere, outside a field" },
  { keys: ["@"], does: "Search clients only", where: "Inside the Command Bar" },
  { keys: ["J"], does: "Next transaction", where: "Transactions" },
  { keys: ["K"], does: "Previous transaction", where: "Transactions" },
  { keys: ["N"], does: "Next transaction needing review", where: "Transactions" },
  { keys: ["Space"], does: "Select / deselect", where: "Transactions" },
  { keys: ["A"], does: "Accept the current transaction", where: "Transactions" },
  { keys: ["Shift", "A"], does: "Accept every selected transaction", where: "Transactions" },
  { keys: ["R"], does: "Recode", where: "Transactions" },
  { keys: ["X"], does: "Exclude", where: "Transactions" },
  { keys: ["Esc"], does: "Close a dialog or panel", where: "Everywhere" },
];

const FAQ: ReadonlyArray<{ q: string; a: string }> = [
  {
    q: "Does Accountant Genie lodge to the ATO?",
    a: "No. It prepares, reviews and exports. BAS and TPAR are prepared for review; lodgement happens in your lodgement software.",
  },
  {
    q: "How is GST calculated?",
    a: "Gross ÷ 11 for GST-inclusive amounts, in integer cents, by deterministic code. The AI classifies; it never computes a tax figure.",
  },
  {
    q: "Can a posted journal be edited?",
    a: "No. Posted entries are immutable. A mistake is corrected by reversing the entry and posting a correcting one, so the audit trail stays whole.",
  },
  {
    q: "What happens when the AI is unsure?",
    a: "The transaction is marked for review with the reason. Abstaining is always allowed; a confident wrong answer is the one outcome the system is built to avoid.",
  },
  {
    q: "Why does a report say a threshold is not applied?",
    a: "Figures that change with legislation are never assumed. They apply once the registered tax agent enters and verifies a version under Settings → Tax rules.",
  },
  {
    q: "Who can see a client?",
    a: "Only people in the same firm. Every query is scoped to the firm on the server; another firm's client answers 'not found', never 'forbidden'.",
  },
];

export default function HelpPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Help"
        title="How Accountant Genie works"
        context="Bank data in, a balanced ledger out. AI proposes, deterministic rules validate, professionals approve, and the ledger is the source of truth."
        action={
          <Link href="/settings" className={buttonClass({ variant: "secondary" })}>
            <Icon name="settings" />
            Settings
          </Link>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {WORKFLOW.map((step) => (
          <Card key={step.title} className="flex flex-col p-5">
            <span className="inline-flex size-11 items-center justify-center rounded-2xl bg-accent-gradient text-white shadow-glow">
              <Icon name={step.icon} className="size-5" />
            </span>
            <h2 className="mt-4 text-base font-bold tracking-tight">{step.title}</h2>
            <p className="mt-1.5 flex-1 text-[13px] leading-relaxed text-ink-2">{step.body}</p>
            <Link href={step.href} className="mt-4 inline-flex items-center gap-1 text-[13px] font-bold text-accent hover:text-accent-ink">
              {step.cta}
              <Icon name="arrow-right" className="size-3.5" />
            </Link>
          </Card>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader title="Keyboard shortcuts" description="The review screen is built to be worked without a mouse." />
          <table>
            <thead>
              <tr>
                <th>Keys</th>
                <th>Does</th>
                <th>Where</th>
              </tr>
            </thead>
            <tbody>
              {SHORTCUTS.map((shortcut) => (
                <tr key={`${shortcut.keys.join("+")}-${shortcut.does}`}>
                  <td>
                    <span className="flex items-center gap-1">
                      {shortcut.keys.map((key) => (
                        <Kbd key={key}>{key}</Kbd>
                      ))}
                    </span>
                  </td>
                  <td className="font-medium">{shortcut.does}</td>
                  <td className="text-ink-2">{shortcut.where}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card>
          <CardHeader title="Questions" description="The ones every firm asks in the first week." />
          <div className="divide-y divide-rule-soft px-5">
            {FAQ.map((item) => (
              <details key={item.q} className="group py-3">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <Icon name="chevron-down" className="size-4 shrink-0 text-ink-3 transition-transform group-open:rotate-180" />
                </summary>
                <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{item.a}</p>
              </details>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
