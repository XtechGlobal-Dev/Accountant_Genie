# Deployment — Vercel · Render · Neon

Accountant Genie runs as three pieces. The split is not arbitrary: it follows from the fact
that an accounting mutation must not be interrupted halfway.

```
  Browser
     │
     ▼
  ┌──────────────────┐   enqueues job id    ┌──────────────────┐
  │  VERCEL          │ ───────────────────► │  RENDER          │
  │  Next.js app     │      Redis (BullMQ)  │  Key Value       │
  │  · pages, forms  │                      └────────┬─────────┘
  │  · server actions│                               │ dequeues
  │  · webhooks      │                      ┌────────▼─────────┐
  │  · SSE progress  │                      │  RENDER          │
  └────────┬─────────┘                      │  Background      │
           │                                │  worker          │
           │         ┌──────────────┐       │  · imports       │
           └────────►│  NEON        │◄──────┤  · reconcile     │
                     │  Postgres    │       │  · feed sync     │
                     └──────────────┘       └────────┬─────────┘
                                                     │
                     ┌──────────────┐                │
                     │  AWS S3      │◄───────────────┘
                     │  statements  │◄─── (app writes uploads)
                     └──────────────┘
```

**Why the worker is a separate host.** A Vercel function ends when its response does. The
in-process job runner in `server/src/jobs/queue.ts` would be killed mid-import — half a
statement posted, half not. Setting `REDIS_URL` flips that module from running jobs inline to
enqueueing them, and the Render worker runs them in a process that outlives the request.

**The one invariant to get right:** `REDIS_URL`, `DATABASE_URL`, `AUTH_SECRET` and the `S3_*`
variables must be *identical* on Vercel and on Render. A mismatch does not error — the app
enqueues into a queue nobody reads, or writes a file the worker cannot find.

---

## 0. Before you start

| You need | Notes |
|---|---|
| A Neon project | Free tier is enough to start. Region `ap-southeast-2` (Sydney). |
| A Render account | The worker needs the **Starter** plan — pre-deploy commands are not on Free. |
| A Vercel account | Hobby works; **Pro is strongly recommended** — see *SSE and function duration* below. |
| An AWS account | One S3 bucket and one IAM user. |
| An Anthropic API key | Optional. Without it the rules + memory tiers still run and the rest goes to review. |

The repository must be on GitHub and reachable by both Vercel and Render.

---

## 1. Neon

1. Create a project, region **AWS ap-southeast-2 (Sydney)** — the same region as the Vercel
   functions below, so queries do not cross the Pacific twice per page.
2. Create a database named `ledgerly`.
3. From **Connection Details**, copy **both** strings. They are different and both are needed:

   | Variable | Which string | Used by |
   |---|---|---|
   | `DATABASE_URL` | **Pooled** — host contains `-pooler` | the app and the worker at runtime |
   | `DIRECT_DATABASE_URL` | **Direct** — no `-pooler` | `prisma migrate deploy` only |

   Keep `?sslmode=verify-full` on both. Neon refuses unencrypted connections.

   Migrations must not go through the pooler: Prisma takes advisory locks during a migration
   and the pooler does not carry them, which fails intermittently and confusingly.

4. **Do not run `db push` against this database, ever.** Production schema changes go through
   `prisma migrate deploy`, which the Render pre-deploy step runs for you.

---

## 2. AWS S3

Uploaded statements are source documents — the bottom of the lineage chain every report figure
traces back through — and they are retained for audit. They cannot live on either host's
filesystem: Vercel's is read-only, and Render's is wiped on each deploy.

`getStorage()` now **throws on boot** if `S3_BUCKET` is unset while `NODE_ENV=production`,
rather than writing files that quietly vanish.

1. Create a bucket, e.g. `accountant-genie-statements`, region **ap-southeast-2**.
2. **Block all public access: ON.** These are clients' complete financial histories.
3. Enable **default encryption** (SSE-S3) and **versioning**.
4. Create an IAM user with programmatic access and this policy, nothing wider:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject"],
      "Resource": "arn:aws:s3:::accountant-genie-statements/*"
    }
  ]
}
```

5. Keep the access key id and secret for the environment variables below.

---

## 3. Render — worker and Redis

`render.yaml` in the repository root declares both services.

1. Render Dashboard → **Blueprints** → **New Blueprint Instance** → pick this repository.
2. Render reads `render.yaml` and proposes `accountant-genie-worker` and
   `accountant-genie-redis`. `REDIS_URL` is wired between them automatically.
3. Fill in every variable marked `sync: false`:

   `DATABASE_URL` · `DIRECT_DATABASE_URL` · `AUTH_SECRET` · `ANTHROPIC_API_KEY` ·
   `S3_BUCKET` · `S3_ACCESS_KEY_ID` · `S3_SECRET_ACCESS_KEY` ·
   `FISKIL_CLIENT_ID` · `FISKIL_CLIENT_SECRET` · `RESEND_API_KEY` · `MAIL_FROM`

   Generate `AUTH_SECRET` once and reuse the same value on Vercel:

   ```
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   ```

4. Apply. On each deploy the worker's pre-deploy step runs:

   ```
   npm run db:deploy         # prisma migrate deploy — every migration, in order
   npm run db:sync-accounts  # applies src/au/coa.ts; idempotent
   ```

   This is **not** `npm run db:seed`. Seeding creates the "Meridian Accounting" demo firm,
   which a database with real clients must never get.

5. Copy the Key Value **external** connection string from the Render dashboard — Vercel needs
   it in the next step, and Vercel cannot reach Render's private network.

**Deploy Render before Vercel.** The schema is migrated by the worker's pre-deploy, so this
order means the app never starts against a database that is behind it.

---

## 4. Vercel — the app

1. Vercel → **Add New → Project** → import the repository.
2. Framework preset **Next.js**. Root directory **`./`** — the repository root *is* the
   frontend package, and `server/` is an npm workspace installed by the same `npm ci`.
3. Leave the build settings alone; `vercel.json` sets them:
   - build `npm run build`, which runs `prisma generate` and then `next build`
   - region `syd1`

   `maxDuration` for the SSE progress route is declared in the route file itself
   (`app/api/jobs/[id]/events/route.ts`), which is the supported way for the App Router
   and keeps the setting next to the code it governs.
4. Add the environment variables, to **Production and Preview**:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | Neon **pooled** |
   | `DIRECT_DATABASE_URL` | Neon **direct** |
   | `REDIS_URL` | Render Key Value **external** string |
   | `AUTH_SECRET` | byte-identical to Render |
   | `S3_BUCKET` `S3_REGION` `S3_ACCESS_KEY_ID` `S3_SECRET_ACCESS_KEY` | as Render |
   | `ANTHROPIC_API_KEY` | as Render |
   | `RESEND_API_KEY` `MAIL_FROM` `SUPPORT_EMAIL` | email |
   | `STRIPE_SECRET_KEY` `STRIPE_WEBHOOK_SECRET` `STRIPE_PRICE_*` | billing |
   | `FISKIL_CLIENT_ID` `FISKIL_CLIENT_SECRET` `FISKIL_WEBHOOK_SECRET` `FISKIL_BASE_URL` `FISKIL_API_VERSION` | bank feeds |
   | `GOOGLE_CLIENT_ID` `GOOGLE_CLIENT_SECRET` | Google sign-in |
   | `RECONCILE_*` | thresholds — see `server/.env.example` |

   Do **not** set `DEMO_PASSWORD` in production. There is no demo firm there.

   There are no `NEXT_PUBLIC_*` variables in this codebase, by design — nothing is inlined into
   the client bundle, so rotating any secret is a redeploy rather than a frontend rebuild.

5. Deploy.

---

## 5. Callback URLs — after the first deploy

Each of these is registered with a third party against your live origin, so none of them can be
set before the domain exists.

| Provider | Where | Value |
|---|---|---|
| Google OAuth | Cloud Console → Credentials → Authorised redirect URIs | `https://<domain>/api/auth/google/callback` |
| Stripe | Dashboard → Webhooks | `https://<domain>/api/stripe/webhook` → paste the signing secret into `STRIPE_WEBHOOK_SECRET` |
| Fiskil | console.fiskil.com → Settings → Webhooks | `https://<domain>/api/webhooks/fiskil` → paste the base64 secret into `FISKIL_WEBHOOK_SECRET` |

**Fiskil event subscriptions cannot be changed after creation** — only the URL can. Subscribe at
minimum to `consent.received`, `consent.revoked`,
`banking.transactions.sync.completed` and `banking.transactions.recent.sync.completed`.

Without `FISKIL_WEBHOOK_SECRET` the endpoint answers **503** rather than trusting an
unauthenticated payload. That is deliberate, not a fault.

Redeploy Vercel after adding the two webhook secrets.

---

## 6. Verify

Each step proves one of the three pieces. Do them in order.

```
# From a local checkout, pointed at the production Neon URLs:
npm run db:check      # both connection strings answer
npm run db:status     # migrate status — "up to date", nothing pending
```

Then in the browser:

1. **Sign up** a firm → proves Neon writes and `AUTH_SECRET` (the one-time code verifies).
2. **Create a client** → proves the session and tenancy.
3. **Upload a CSV statement** (there is one in `server/samples/`) → proves S3 *and* the queue.
   The Activity Panel must show stage events moving.
4. **Render logs** should show `[worker] listening`, then `[worker] done <id>`.
5. **Open the Trial Balance** → proves the ledger reads, and that it sums to zero.

### What "broken" looks like

| Symptom | Cause |
|---|---|
| Upload succeeds, progress bar never moves | `REDIS_URL` differs between Vercel and Render |
| Worker exits immediately | `REDIS_URL` not set on Render — the worker refuses to run pointlessly |
| Boot error naming `S3_BUCKET` | Storage not configured. By design, not a regression |
| `Cannot find module 'tsx'` on Render | The build command lost `--include=dev`; Render sets `NODE_ENV=production` |
| Migration hangs or fails oddly | `DIRECT_DATABASE_URL` is pointed at the **pooled** host |
| Stripe plan changes never apply | Webhook secret missing — the webhook is the only thing that changes a plan |

---

## 7. Known limitations of this topology

Real, and worth knowing before the first client is on it.

**SSE and function duration.** `/api/jobs/[id]/events` streams for up to 15 minutes. Vercel caps
a function at 300s on Pro, 60s on Hobby (300s with Fluid Compute). A long import's stream is cut
at the cap. The browser reconnects on its own and the route replays from the persisted
`JobEvent` rows, so no progress is *lost* — but the replay restarts from the beginning, so the
Activity Panel can show duplicated stage lines on a long job. The proper fix is honouring
`Last-Event-ID` in that route. On Hobby this is bad enough to notice; use Pro.

**Reports and exports still run inside the request.** A large General Ledger or EOFY export can
exceed the function cap. This is already on the open list in `CLAUDE.md §9`; moving them onto the
job queue is the fix, and the queue now exists in production to move them to.

**Redis is reachable from the public internet.** Vercel's egress has no fixed IP range, so the
Key Value service cannot be IP-restricted to it. The connection string is the only credential —
rotate it if it is ever exposed. Moving the app to a Render Web Service would let the queue go
private.

**Neon cold starts.** The free tier suspends a compute after inactivity and the first request
then waits several seconds. Turn off scale-to-zero before anyone relies on it.

**No malware scanning on uploads**, and **no admin dashboard** — both still open from
`CLAUDE.md §9`. Neither is created or solved by this deployment.

---

## 8. Routine operations

```
# Schema change: commit the migration and push. Render's pre-deploy applies it.
npx prisma migrate dev --name <name>     # local — creates the migration
git push                                 # Render migrates, then Vercel builds

# Chart of accounts change (server/src/au/coa.ts): the same push. Idempotent.

# Check production migration state without deploying:
npm run db:status

# Rotate AUTH_SECRET: change it on BOTH hosts in one sitting. Every pending
# one-time code and every trusted device is invalidated — that is the point.
```

**Rollback.** Vercel's instant rollback reverts the app only; it does not revert a migration.
Write migrations so the previous app version still runs against the new schema — add columns,
do not rename them — or a rollback takes the app down.
