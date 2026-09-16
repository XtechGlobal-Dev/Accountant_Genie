/**
 * Proves the Fiskil credentials against the live API, through the same client
 * the application uses.
 *
 *   npm run fiskil:check
 *   npm run fiskil:check -- --transactions
 *
 * This exercises `src/modules/banking/fiskil/` rather than reimplementing the
 * calls, so a green run means the application's own transport, token cache,
 * version header and list-unwrapping all work — not merely that the
 * credentials are valid.
 *
 * It is READ-ONLY: it creates no end users and no consents, so it is safe to
 * run anywhere. With `--transactions` it samples real payloads and reports
 * which fields our normaliser actually resolved, which is how the mapping was
 * taken from "plausible" to "confirmed" — and how it stays confirmed when
 * Fiskil changes something.
 *
 * `server-only` throws outside the React server condition, so this runs under
 * `--conditions=react-server` (see the package script).
 */
import { fiskil } from "../src/modules/banking/fiskil/client";
import { fiskilConfig, webhookConfigured } from "../src/modules/banking/fiskil/config";
import { normaliseAccount, normaliseTransaction } from "../src/modules/banking/fiskil/normalise";
import type { FiskilTransaction } from "../src/modules/banking/fiskil/types";
import { FiskilApiError, FiskilConfigError } from "../src/modules/banking/fiskil/errors";

// The environment may already be set (CI, a host): a missing .env is not an error.
try {
  process.loadEnvFile(".env");
} catch {
  // .env is absent — the environment is expected to provide the variables.
}

const wantTransactions = process.argv.includes("--transactions");

const heading = (text: string) => console.log(`\n${text}`);
const line = (label: string, value: string) => console.log(`  ${label.padEnd(22)} ${value}`);

/** Never print a secret, even a sandbox one — logs outlive their environment. */
const redact = (v: string) => (v.length <= 8 ? "********" : `${v.slice(0, 4)}…${v.slice(-2)}`);

const isPending = (row: FiskilTransaction) =>
  String(row.status ?? "").toUpperCase() === "PENDING";

async function main(): Promise<number> {
  const config = fiskilConfig();
  if (!config) {
    console.log(
      "\nFiskil is not configured.\n" +
        "  Set FISKIL_CLIENT_ID and FISKIL_CLIENT_SECRET in server/.env\n" +
        "  (console.fiskil.com > Settings > API Keys — the secret is shown once).\n",
    );
    return 1;
  }

  heading("Configuration");
  line("base URL", config.baseUrl);
  line("API version", `${config.apiVersion}  (sent as X-Fiskil-Version)`);
  line("client id", redact(config.clientId));
  line(
    "webhook secret",
    webhookConfigured()
      ? "set — /api/webhooks/fiskil will verify deliveries"
      : "not set — /api/webhooks/fiskil returns 503; use Sync now",
  );

  heading("Token exchange");
  const startedAt = Date.now();
  let institutions;
  try {
    // Any call forces the exchange; institutions is the cheapest read that
    // also proves the client_id query-param quirk is handled.
    institutions = await fiskil.listInstitutions();
    line("status", `ok  (${Date.now() - startedAt}ms)`);
  } catch (error) {
    if (error instanceof FiskilConfigError) {
      console.log(`\n  FAILED — ${error.message}\n`);
      return 1;
    }
    if (error instanceof FiskilApiError) {
      console.log(`\n  FAILED — ${error.message}\n  retryable: ${error.retryable}\n`);
      return 1;
    }
    throw error;
  }

  heading("Institutions");
  line("count", String(institutions.length));
  for (const institution of institutions.slice(0, 4)) {
    line("", `${institution.id}  ${institution.name ?? "(unnamed)"}`);
  }
  if (institutions.length > 4) line("", `… and ${institutions.length - 4} more`);

  heading("End users");
  const endUsers = await fiskil.listEndUsers({ "page[size]": 20 });
  line("count", String(endUsers.length));
  if (endUsers.length === 0) {
    console.log("\n  None yet. Connect a feed from a client's Banks page to create one.\n");
    return 0;
  }
  for (const endUser of endUsers.slice(0, 10)) {
    line("", `${endUser.id}  ${endUser.name ?? ""}`);
  }

  heading("Consents and data (first end user with an active consent)");
  for (const endUser of endUsers) {
    const consents = await fiskil.listConsents({ end_user_id: endUser.id }).catch(() => []);
    const active = consents.filter((c) => c.active !== false && !c.revoked_at);
    if (active.length === 0) continue;

    line("end user", endUser.id);
    line("consents", `${consents.length} (${active.length} active)`);
    for (const consent of active.slice(0, 3)) {
      line(
        "",
        `${consent.consent_id ?? consent.arrangement_id} @ ` +
          `${consent.institution_name ?? consent.institution_id ?? "?"} ` +
          `expires ${consent.expires_at ?? "?"}`,
      );
    }

    const accounts = await fiskil.listAccounts(endUser.id).catch(() => []);
    line("accounts", String(accounts.length));
    for (const raw of accounts.slice(0, 6)) {
      const account = normaliseAccount(raw);
      line(
        "",
        account
          ? `${account.name.slice(0, 32).padEnd(32)} ****${account.mask ?? "?"}  ${account.kind.padEnd(11)} ${account.productCategory ?? ""}`
          : "UNMAPPABLE (no account id)",
      );
    }

    if (!wantTransactions) {
      console.log("\n  Re-run with --transactions to sample transaction payloads.\n");
      return 0;
    }

    // A generous page, because unsettled authorisations sort first and a small
    // sample can be entirely PENDING — which would say nothing about whether
    // the settled-transaction mapping works.
    const page = await fiskil.listTransactions({ end_user_id: endUser.id, "page[size]": 200 });
    const rows = (page.transactions ?? []) as FiskilTransaction[];

    heading("Transactions");
    line("sampled", String(rows.length));
    if (rows.length === 0) {
      console.log("\n  None yet — the bank sync may still be running.\n");
      return 0;
    }

    const settled = rows.filter((row) => !isPending(row));
    line("settled", `${settled.length}  (${rows.length - settled.length} pending, not ledgerable)`);

    const specimen = settled[0] ?? rows[0]!;
    heading("Field names on a settled transaction");
    console.log(`  ${Object.keys(specimen).sort().join("\n  ")}`);

    heading("Full payload");
    console.log(JSON.stringify(specimen, null, 2));

    let mapped = 0;
    let pending = 0;
    let withPosted = 0;
    let withCategory = 0;
    let withMerchantCode = 0;
    const failures: string[] = [];

    for (const row of rows) {
      const result = normaliseTransaction(row);
      if (result.ok) {
        mapped += 1;
        if (result.transaction.postedAt) withPosted += 1;
        if (result.transaction.feedCategory) withCategory += 1;
        if (result.transaction.feedMerchantCode) withMerchantCode += 1;
        continue;
      }
      if (result.reason === "pending") {
        pending += 1;
        continue;
      }
      failures.push(`${result.reason}  ${result.externalId ?? "(no id)"}`);
    }

    heading("Through our normaliser");
    for (const row of settled.slice(0, 8)) {
      const result = normaliseTransaction(row);
      if (!result.ok) continue;
      const t = result.transaction;
      line(
        "",
        `${t.date.toISOString().slice(0, 10)} ${(t.amountCents / 100).toFixed(2).padStart(11)}  ` +
          `${t.description.slice(0, 32).padEnd(32)} ` +
          `[${t.feedCategory ?? "-"}/${t.feedSubcategory ?? "-"}` +
          `${t.feedCategoryConfidence ? ` ${t.feedCategoryConfidence}` : ""}] ` +
          `mcc=${t.feedMerchantCode ?? "-"}`,
      );
    }

    heading("Mapping");
    line("mapped", `${mapped}/${settled.length} settled`);
    line("pending skipped", String(pending));
    line("failures", failures.length ? failures.slice(0, 10).join("\n" + " ".repeat(25)) : "none");

    // Coverage of the signals the reconciliation engine actually leans on. A
    // field that is present in the schema but empty in practice is worth
    // knowing about before it is designed around.
    heading("Signal coverage (mapped rows)");
    line("posted date", `${withPosted}/${mapped}`);
    line("category", `${withCategory}/${mapped}`);
    line("merchant code", `${withMerchantCode}/${mapped}`);

    if (failures.length > 0) {
      console.log("\n  Settled rows failed to map. Compare the field names above with normalise.ts.\n");
      return 1;
    }
    console.log("\n  Every settled row mapped cleanly.\n");
    return 0;
  }

  console.log("\n  No active consent found. Complete a bank connection first.\n");
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error("\nUnexpected failure:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
