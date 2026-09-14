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
| 2. Dependencies | Checks `node_modules` in both packages, runs `pnpm install` if either is absent | Tells you to install pnpm |
| 3. Prisma client | `prisma generate` → `server/generated/prisma` | Propagates the Prisma error |
| 4. Database schema | `prisma db push`, then applies `prisma/sql/constraints.sql` | Propagates |
| 5. Demo data | Seeds **only if the `Firm` table is empty** | Skips on any doubt |
| 6. Starting | `next dev`, plus the BullMQ worker when `REDIS_URL` is set | One Ctrl-C stops everything |

```bash
npm run dev                  # the whole pipeline, then the app
npm run dev -- --port 4000   # different port
npm run dev -- --seed        # force a reseed even if data exists
npm run dev:fast             # skip steps 3–5 (nothing schema-related changed)
npm run dev:app              # raw `next dev`, no preflight at all
```

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
