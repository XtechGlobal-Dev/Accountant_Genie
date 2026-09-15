# scripts/

Repository-level automation. These orchestrate **both packages** — the root
frontend and `server/` — so a contributor never has to know which command
belongs to which one.

Anything that belongs to only one package stays in that package instead:
backend-only tooling lives in `server/scripts/` (`worker.ts`,
`check-connection.ts`, `list-models.ts`).

---

## `npm run dev` → `dev.mjs`

The single entry point for running Accountant Genie locally. It does the backend work
first, because the frontend cannot render a page without a generated Prisma
client and a schema that matches it.

| Step | What happens | Fails how |
|---|---|---|
| 1. Environment | Loads `server/.env`. Missing? Copies `.env.example` and stops with instructions. Placeholder `DATABASE_URL`? Stops. | Exits 1 with what to fix |
| 2. Dependencies | Checks the root `node_modules`, runs `npm install` if absent — one workspace install covers both packages | Repeats npm's own error |
| 3. Prisma client | `prisma generate` → `server/generated/prisma` | Propagates the Prisma error |
| 4. Database schema | `prisma db push`, then applies `prisma/sql/constraints.sql` | Propagates |
| 5. Demo data | Seeds **only if the `Firm` table is empty** | Skips on any doubt |
| 6. Starting | `next dev`, plus the BullMQ worker when `REDIS_URL` is set, then opens the app in your browser | One Ctrl-C stops everything |

```bash
npm run dev                  # the whole pipeline, then the app
npm run dev -- --port 4000   # different port
npm run dev -- --seed        # force a reseed even if data exists
npm run dev -- --no-open     # do not open a browser
npm run dev:fast             # skip steps 3–5 (nothing schema-related changed)
npm run dev:app              # raw `next dev`, no preflight at all
```

### Opening the browser

Step 6 opens `http://localhost:<port>` once the server actually answers, not
when `next dev` is spawned — the first compile takes seconds, and opening
early lands on a connection error. The poll runs in the background, so the
terminal stays live and Ctrl-C during the first compile cancels the tab
rather than racing it.

It stays out of the way when it should: `--no-open`, `BROWSER=none` (the
convention other dev servers follow) and any `CI` environment all skip it.
`npm run dev:app` never opens anything — it is raw `next dev`.

---

### Two deliberate safety properties

- **Seeding never clobbers data.** Step 5 counts rows in `Firm` and does nothing
  unless the count is zero. `--seed` is the only way to force it.
- **`db push` is never given `--accept-data-loss`.** On a destructive schema
  change Prisma stops and asks rather than dropping a column of ledger rows.
  This matters more than convenience: posted journal entries are immutable.

---

## `lib/`

| File | Purpose |
|---|---|
| `util.mjs` | Paths, colour, logging, and the two process helpers |
| `steps.mjs` | Each pipeline step as an independent, reusable function |

`dev.mjs` stays a readable list of intentions; the mechanics live in `lib/`.

### Why `binJs()` exists

Spawning `node_modules/.bin/<tool>` needs a shell on Windows, where those are
`.CMD` shims. A shell then splits this repo's path on the space in
`Gaurav Mehra` and the command dies with
`'D:\Gaurav' is not recognized`. So `binJs()` reads the tool's `package.json`
and returns its JavaScript entrypoint, which is run as `node <file>` — no
shell, no quoting, no platform difference.

---

## Adding a script

1. Put reusable work in `lib/steps.mjs`, not in the entry file.
2. Use `log.step` / `log.ok` / `log.warn` / `log.fail` so output stays uniform.
3. Add the npm script to the **root** `package.json` and document it here.
