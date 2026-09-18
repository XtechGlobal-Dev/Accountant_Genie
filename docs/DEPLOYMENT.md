# Deployment — Render · Neon

Accountant Genie runs as three pieces on Render over one Neon database. The split is not
arbitrary: it follows from the fact that an accounting mutation must not be interrupted halfway.

```
  Browser
     │
     ▼
  ┌──────────────────┐   enqueues job id    ┌──────────────────┐
  │  RENDER          │ ───────────────────► │  RENDER          │
  │  Web service     │   Redis (BullMQ)     │  Key Value       │
  │  · pages, forms  │   private network    └────────┬─────────┘
  │  · server actions│                               │ dequeues
  │  · webhooks      │                      ┌────────▼─────────┐
  │  · SSE progress  │                      │  RENDER          │
  │  · owns migrations                      │  Background      │
  └────────┬─────────┘                      │  worker          │
           │                                │  · imports       │
           │         ┌──────────────┐       │  · reconcile     │
           └────────►│  NEON        │◄──────┤  · feed sync     │
                     │  Postgres    │       │                  │
                     └──────────────┘       └────────┬─────────┘
                                                     │
                     ┌──────────────┐                │
                     │  AWS S3      │◄───────────────┘
                     │  statements  │◄─── (app writes uploads)
                     └──────────────┘
```

All three are declared in [`render.yaml`](../render.yaml) and deploy from one Blueprint.

**Why the worker is a separate service.** The in-process job runner in
`server/src/jobs/queue.ts` runs a job on the process that served the request, so a deploy, a
timeout or a dropped connection kills it mid-import — half a statement posted, half not. Setting
`REDIS_URL` flips that module from running jobs inline to enqueueing them, and the worker runs
them in a process that outlives the request.

**Why the app is on Render and not Vercel.** It was on Vercel, and that works, but a Vercel
function is capped at 300s on Pro and `/api/jobs/[id]/events` streams progress for up to 15
minutes — so the Activity Panel's stream was cut and replayed on every long import. Keeping both
halves on Render also puts the queue on the private network: `ipAllowList` is empty, and the
Redis connection string is never exposed to the internet. See §7 for what this costs.

**Running on Vercel instead.** There is no worker there and no process that outlives a
response, so `server/src/jobs/queue.ts` finishes the job under `after()` on the invocation that
enqueued it. That crosses no network, so it meets no Deployment Protection and needs no
configuration at all. If `after()` has no request to attach to it falls back to POSTing the job
id to `/api/jobs/run` — which does cross the network, so a protected deployment answers the
self-call with an SSO redirect and the route is never reached; `VERCEL_AUTOMATION_BYPASS_SECRET`
is what gets through that. Three things to know.

- **Check Project Settings → Functions → Function Max Duration.** Under `after()` the job shares
  the calling route's budget. Vercel's default with Fluid compute is 300s, which is what the
  numbers below assume; a project left at 10s or 15s cuts the coding stage off mid-file, and no
  change in this repository can lift it.

- **`S3_BUCKET` is not optional on Vercel.** The upload and the job that reads the file back are
  now separate invocations, and `getStorage()` refuses local disk in production for exactly this
  reason. Statements are source documents; a read-only filesystem cannot hold one.
- **300s bounds one job.** The coding stage is two AI calls over the file, measured at ~80s for
  31 rows and around three minutes for 187. A statement large enough to exceed the ceiling is
  cut off mid-stage, and the job sits RUNNING until `reapStaleJobs` marks it retryable at thirty
  minutes. That is the ceiling Render and the BullMQ worker do not have — it is the reason the
  deployment moved, and the reason a firm importing a year of statements should be on Render.
  A preview deployment additionally needs `VERCEL_AUTOMATION_BYPASS_SECRET`, or Vercel
  Authentication answers the self-call with a login page.

**The one invariant to get right:** `AUTH_SECRET`, `DATABASE_URL` and the `S3_*` variables must
be *identical* on the web service and the worker. A mismatch does not error — the app writes a
file the worker cannot find, or issues a one-time code the worker's pepper rejects. `REDIS_URL`
cannot drift, because both services read it from the same `fromService` block.

**Migrations belong to the web service only.** Render deploys blueprint services in parallel, so
exactly one of them can own `db:deploy && db:sync-accounts` — two concurrent `db:sync-accounts`
runs race each other over the same rows. The app owns it because a user-facing 500 from a column
that does not exist yet is worse than a job that fails and is retried with backoff.

---

## 0. Before you start

| You need | Notes |
|---|---|
| A Neon project | Free tier is enough to start. Region `ap-southeast-2` (Sydney). |
| A Render account | Both services need the **Starter** plan — pre-deploy commands are not on Free, and a Free web service sleeps. |
| A domain | Pointed at the web service by CNAME. TLS is issued by Render. |
| An AWS account | One S3 bucket and one IAM user. |
| An Anthropic API key | Optional. Without it the rules + memory tiers still run and the rest goes to review. |

The repository must be on GitHub and reachable by Render.

---

## 1. Neon

1. Create a project, region **AWS ap-southeast-2 (Sydney)**. Put the Render services in the
   region closest to it, so a page doing several sequential queries does not pay the round
   trip each time — see *Region skew* in §7.
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
filesystem: Render's is wiped on each deploy, and the app and the worker are separate
processes that both need the same file anyway.

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

## 3. Render — the Blueprint

[`render.yaml`](../render.yaml) in the repository root declares all three services:
`accountant-genie-app` (web), `accountant-genie-worker` and `accountant-genie-redis`.

1. Render Dashboard → **Blueprints** → **New Blueprint Instance** → pick this repository.
2. Render reads `render.yaml` and proposes the three. `REDIS_URL` is wired into both the app
   and the worker automatically, from the same `fromService` block, so they cannot drift.
3. Fill in every variable marked `sync: false`. The full list is in the
   [Appendix](#appendix--environment-variables); the ones with no sensible default are:

   `DATABASE_URL` · `DIRECT_DATABASE_URL` · `AUTH_SECRET` · `ANTHROPIC_API_KEY` ·
   `S3_BUCKET` · `S3_ACCESS_KEY_ID` · `S3_SECRET_ACCESS_KEY` ·
   `FISKIL_CLIENT_ID` · `FISKIL_CLIENT_SECRET` · `RESEND_API_KEY` · `MAIL_FROM`

   Generate `AUTH_SECRET` once and paste the **same** value into both services:

   ```
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   ```

   The web service additionally takes `SUPPORT_EMAIL`, `GOOGLE_CLIENT_*`, `STRIPE_*` and
   `FISKIL_WEBHOOK_SECRET` — it is the half that serves forms and receives webhooks.

   Do **not** set `DEMO_PASSWORD`. There is no demo firm in production.

   There are no `NEXT_PUBLIC_*` variables in this codebase, by design — nothing is inlined into
   the client bundle, so rotating any secret is a redeploy rather than a frontend rebuild.

4. Apply. On each deploy the **web service's** pre-deploy step runs:

   ```
   npm run db:deploy         # prisma migrate deploy — every migration, in order
   npm run db:sync-accounts  # applies src/au/coa.ts; idempotent
   ```

   This is **not** `npm run db:seed`. Seeding creates the "Meridian Accounting" demo firm,
   which a database with real clients must never get.

   The worker has no pre-deploy step, deliberately — see *Migrations belong to the web service
   only* at the top of this document.

5. Add your domain: web service → **Settings → Custom Domains** → add it, then point the CNAME
   at the target Render shows you. TLS is issued automatically once DNS resolves.

**Both services need the Starter plan.** Pre-deploy commands are not available on Free, and a
Free web service sleeps — which for the worker means jobs simply stop running.

---

## 4. Migrating off Vercel

Skip this if you are deploying fresh.

The app ran on Vercel until the SSE cap and the split environment made it not worth it. To move
an existing deployment:

1. Bring the Render web service up first and verify it on its own `.onrender.com` URL —
   §6 below is the check list. Leave Vercel serving the domain while you do.
2. While both are live, the queue must stay publicly reachable: add `- source: 0.0.0.0/0` back
   to `ipAllowList` in `render.yaml` temporarily, because Vercel's egress has no fixed range
   and cannot use Render's private network.
3. Move the domain: remove it from the Vercel project **first** (a domain cannot be verified on
   two platforms at once), then add it on Render and update the CNAME.
4. Once DNS has propagated and the Render service is serving the domain, delete the Vercel
   project and restore `ipAllowList: []`. Redeploy so the queue goes private again.

`vercel.json` is kept in the repository so the Vercel path still works if you ever want it back.
It is inert on Render.

**One thing that caused a day of confusion and is worth knowing:** Vercel scopes each
environment variable to Production, Preview and/or Development separately, and creating a
**Production** variable needs a team role that a plain member does not have. A project whose
variables are all Preview-scoped builds and serves fine, and then returns 500 on every request
that touches the database, because `DATABASE_URL` is simply absent at runtime. Render has no
such split: a service's environment is its environment.

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

Redeploy the web service after adding the two webhook secrets.

---

## 6. Verify

Each step proves one of the three pieces. Do them in order, against the `.onrender.com` URL
before you move the domain.

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
4. **Worker logs** should show `[worker] listening`, then `[worker] done <id>`.
5. **Open the Trial Balance** → proves the ledger reads, and that it sums to zero.

### What "broken" looks like

| Symptom | Cause |
|---|---|
| Upload succeeds, progress bar never moves | The worker is down, or the two services are in different regions and the private address does not resolve |
| Worker exits immediately | `REDIS_URL` not set — the worker refuses to run pointlessly |
| 500 on every request, pages themselves render | A required variable is missing on the web service. Prerendered pages are served from cache; the first query throws. Check the Logs tab for the thrown message |
| Boot error naming `S3_BUCKET` | Storage not configured. By design, not a regression |
| `Cannot find module 'tsx'` or `next: not found` | The build command lost `--include=dev`; Render sets `NODE_ENV=production`, which drops devDependencies |
| Schema is behind the app after a deploy | The pre-deploy step is missing from the **web** service, or was left on the worker as well |
| Migration hangs or fails oddly | `DIRECT_DATABASE_URL` is pointed at the **pooled** host |
| Stripe plan changes never apply | Webhook secret missing — the webhook is the only thing that changes a plan |
| Sign-up works, the code never arrives | `RESEND_API_KEY`/`MAIL_FROM` unset. The console transport does not throw; in production it withholds the body and logs only that nothing was sent |

---

## 7. Known limitations of this topology

Real, and worth knowing before the first client is on it.

**No CDN in front of the app.** A Render web service is one origin in one region. Static assets
are served by Next from that instance rather than from an edge cache, so first paint from far
away is slower than it was on Vercel. For a keyboard-driven tool used by a firm in one country
this is a fair trade; put Cloudflare in front if it ever stops being one.

**Region skew.** The Render services are in `singapore` and Neon is in `ap-southeast-2`
(Sydney) — roughly 90ms added to every query round trip, and a page doing several sequential
queries feels it. Moving Neon to Singapore, or the services to Render's Sydney region, removes
it. Pick one and make them match.

**`Last-Event-ID` is still not honoured.** `/api/jobs/[id]/events` replays from the persisted
`JobEvent` rows on reconnect, starting from the beginning, so a dropped stream can show
duplicated stage lines in the Activity Panel. No progress is *lost*. This mattered more on
Vercel, where the function cap forced a reconnect on every long import; on Render the stream is
not cut, so it now only shows up on a genuinely dropped connection.

**Reports and exports still run inside the request.** A large General Ledger or EOFY export
holds a request open for as long as it takes. There is no hard function cap here to truncate it,
which makes this less acute than it was on Vercel, but it still ties up a worker thread on a
single instance. This is on the open list in `CLAUDE.md §9`; moving them onto the job queue is
the fix, and the queue exists in production to move them to.

**One web instance.** Starter is a single instance, so a deploy is a brief interruption and
there is no horizontal headroom. Render's autoscaling is the answer when it is needed; the app
is stateless apart from the session cookie, so nothing in the code prevents it.

**Neon cold starts.** The free tier suspends a compute after inactivity and the first request
then waits several seconds. Turn off scale-to-zero before anyone relies on it.

**No malware scanning on uploads**, and **no admin dashboard** — both still open from
`CLAUDE.md §9`. Neither is created or solved by this deployment.

---

## 8. Routine operations

```
# Schema change: commit the migration and push. Render's pre-deploy applies it.
npx prisma migrate dev --name <name>     # local — creates the migration
git push                                 # Render builds, pre-deploy migrates, then serves

# Chart of accounts change (server/src/au/coa.ts): the same push. Idempotent.

# Check production migration state without deploying:
npm run db:status

# Rotate AUTH_SECRET: change it on BOTH hosts in one sitting. Every pending
# one-time code and every trusted device is invalidated — that is the point.
```

**Rollback.** Vercel's instant rollback reverts the app only; it does not revert a migration.
Write migrations so the previous app version still runs against the new schema — add columns,
do not rename them — or a rollback takes the app down.
