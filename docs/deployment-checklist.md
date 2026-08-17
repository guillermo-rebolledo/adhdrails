# Deployment Checklist — Staging & Production

The one-page guide to getting both environments live. Written to be followed top
to bottom. Each box is one bounded action. Do them in order; later steps assume
earlier ones are done.

**Golden path once everything below is set:**

```bash
pnpm release:staging      # verify → verify env → migrate (expand) → deploy (custom env)
pnpm release:production   # same + typed confirmation, retention check & restore point
```

If those two commands run clean and the post-deploy checks pass, you're done.
Everything else in this file exists to make those two commands work.

---

## 0. How the environments are shaped (read once)

Rails uses **four** isolated tiers: local, preview, staging, production.

- **Local** — your machine. Uses dev fallbacks; needs almost no secrets.
- **Preview** — Vercel Preview deployments of feature branches. Scoped to the
  **Preview** environment. Previews **never** receive production access — the
  app boot (`src/instrumentation.ts`) fails closed if a preview is ever handed
  `APP_ENV=production`.
- **Staging** — a **Vercel custom environment** named `staging` (a Pro feature)
  with its own variable scope and its own stable domain. It is a first-class
  environment, not a Preview alias. Deploys with `vercel deploy --target=staging`.
- **Production** — the Production deployment. Env vars are scoped **Production**.

All four tiers are fully separate: separate OAuth clients, separate Neon
databases, separate Inngest environments, separate VAPID keys, separate
analytics, separate secrets. Nothing is shared. Each deployed tier carries an
`APP_ENV` marker (`staging` / `production`) that the release scripts verify
before they touch anything, so a production release can never run against a
staging (or stale local) configuration.

**Create the `staging` custom environment once:** Vercel → Project → Settings →
Environments → **Create environment** → name it `staging`. Assign it a stable
domain (Project → Domains → add `adhdrails-staging.vercel.app` or your own →
attach to the `staging` environment). After this, staging vars are scoped to the
**staging** environment (§4).

**One limitation to know now:** Google push notifications (live calendar sync)
need a domain you can add DNS records to. A `*.vercel.app` domain is one you
don't control DNS for, so **real push notifications do not work on staging**
unless you give staging a custom domain you own. Everything else (sign-in,
calendar connect, import, agenda) works on staging as-is. See §7.

---

## 1. Prerequisites — accounts & tools (do once, ~30 min)

- [ ] **Vercel** project created and linked (`vercel link`).
- [ ] **Neon** account (Postgres) — via the Vercel Marketplace is easiest.
- [ ] **Google Cloud** project with the **Google Calendar API** enabled.
- [ ] **Inngest** account, with the **Vercel ↔ Inngest integration** installed
      (Vercel → Project → Integrations → Inngest). This auto-injects the Inngest
      keys and auto-syncs the app on every deploy.
- [ ] **`openssl`** available locally (for generating secrets). Check:
      `openssl version`.
- [ ] (Optional but recommended) A **custom domain** you control DNS for — needed
      for live push notifications. See §7.
- [ ] (Optional) **Umami Cloud** account with a website created in the **US
      region** — content-free product analytics. Create a **separate website per
      environment** and copy each **Website ID** for §4. Skip entirely to leave
      analytics off (the app runs fine without it). No session replay is used.

---

## 2. Generate the secrets you'll paste in (~5 min)

Run each command, keep the output for §4. Generate a **different** value per
environment (never reuse a staging secret in production).

- [ ] Auth secret: `openssl rand -base64 32`
- [ ] Calendar token key (encrypts Google refresh tokens): `openssl rand -base64 32`
      — must decode to exactly 32 bytes; `openssl rand -base64 32` already does.
- [ ] Operational-audit pseudonym secret: `openssl rand -base64 32` — used to
      derive the opaque account reference on metadata-only audit records so a raw
      account id is never stored. **Required in production** (the app throws on
      boot without it); recommended in staging.

Do this twice: once for staging, once for production.

---

## 3. Google Cloud — OAuth clients & scopes (~20 min)

Make **two** OAuth clients (one per environment) so a leak in one never touches
the other.

For **each** environment's OAuth client (Google Cloud → APIs & Services →
Credentials → Create OAuth client ID → Web application):

- [ ] Add **Authorized redirect URIs** (replace the host per environment):

  ```
  https://<host>/api/auth/callback/google      # Better Auth sign-in
  https://<host>/api/calendar/callback          # Calendar incremental grant
  ```

  - Staging host: `adhdrails-staging.vercel.app`
  - Production host: `<your-production-domain>`

- [ ] Copy the **Client ID** and **Client Secret** — they go in §4.
- [ ] On the **OAuth consent screen**, add both hosts under **Authorized
      domains** (needs domain verification for a real domain; `*.vercel.app` is
      pre-trusted for sign-in but **not** for push — see §7).

Scopes are set in code (identity + `calendar.readonly` + `calendar.events`); you
don't configure them here beyond publishing the consent screen.

---

## 4. Environment variables (the core list)

Set these in **Vercel → Project → Settings → Environment Variables**. Scope
staging vars to the **staging** custom environment; scope production vars to
**Production**.

`<host>` = `adhdrails-staging.vercel.app` for staging, your production domain for
production.

### Must set (app will not work without these)

| Variable                     | Value                    | Notes                                                    |
| ---------------------------- | ------------------------ | -------------------------------------------------------- |
| `APP_ENV`                    | `staging` / `production` | Tier marker the release scripts verify before mutating   |
| `DATABASE_URL`               | Neon connection string   | **Different DB per environment** (§5)                    |
| `BETTER_AUTH_URL`            | `https://<host>`         | Fixes the "Invalid origin" auth error                    |
| `NEXT_PUBLIC_APP_URL`        | `https://<host>`         | Same value; must match `BETTER_AUTH_URL`'s host          |
| `BETTER_AUTH_SECRET`         | from §2                  | Different per environment                                |
| `GOOGLE_CLIENT_ID`           | from §3                  | Per-environment OAuth client                             |
| `GOOGLE_CLIENT_SECRET`       | from §3                  | Per-environment OAuth client                             |
| `CALENDAR_TOKEN_KEY_VERSION` | `1`                      | Bump only when rotating keys                             |
| `CALENDAR_TOKEN_KEY_V1`      | from §2                  | 32-byte base64; encrypts refresh tokens                  |
| `VAPID_SUBJECT`              | `mailto:you@domain`      | Web Push contact; **different key pair per environment** |
| `VAPID_PUBLIC_KEY`           | VAPID key pair           | `pnpm exec web-push generate-vapid-keys --json`          |
| `VAPID_PRIVATE_KEY`          | VAPID key pair           | Server-only; never exposed to the browser                |

> The release scripts verify all three VAPID variables are present (isolated Web
> Push keys per environment). Generate a **separate** key pair for staging and
> production.

> `APP_ENV` is the authoritative tier signal. `pnpm release:staging` refuses to
> run unless the pulled environment is `APP_ENV=staging`, and
> `pnpm release:production` refuses unless it is `APP_ENV=production`. Never set
> `APP_ENV=production` on any environment other than Production — the app boot
> rejects a Preview that carries it.

### Set when using push notifications (live calendar sync)

| Variable               | Value                                 | Notes                                                                                |
| ---------------------- | ------------------------------------- | ------------------------------------------------------------------------------------ |
| `CALENDAR_WEBHOOK_URL` | `https://<host>/api/calendar/webhook` | Only needed if the public URL differs from `BETTER_AUTH_URL`; safe to set explicitly |

### Operational audit (required in production)

| Variable                             | Value   | Notes                                                                                                                                     |
| ------------------------------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `OPERATIONAL_AUDIT_PSEUDONYM_SECRET` | from §2 | **Required in production** — the app throws on boot without it. Different per environment. Never stores raw account ids in audit records. |

### Neon restore points & retention (required for production releases)

`pnpm release:production` verifies point-in-time recovery retention and creates
a verified restore point before migrating. Set these for the **production**
environment (they are also read by `pnpm restore:drill` and the rehearsal).

| Variable          | Value                   | Notes                                                      |
| ----------------- | ----------------------- | ---------------------------------------------------------- |
| `NEON_API_KEY`    | Neon personal/API key   | Scope to the production project. Never set on Preview.     |
| `NEON_PROJECT_ID` | Neon project id         | The production project.                                    |
| `NEON_BRANCH_ID`  | Neon branch id (`br-…`) | The production branch snapshots and restore drills act on. |

### Analytics (optional — content-free product analytics)

Leave unset to disable analytics entirely (local and preview builds should not
report into a production property). The tracker is pinned to Umami Cloud in code,
the website is created in Umami's US region, and no session replay is used.

| Variable                       | Value                 | Notes                                                     |
| ------------------------------ | --------------------- | --------------------------------------------------------- |
| `NEXT_PUBLIC_UMAMI_WEBSITE_ID` | Umami Website ID (§1) | Public (browser) var. Use a **separate website per env**. |

### Auto-managed by the Inngest integration (do not set by hand)

| Variable              | Source                                     |
| --------------------- | ------------------------------------------ |
| `INNGEST_EVENT_KEY`   | Injected by the Vercel↔Inngest integration |
| `INNGEST_SIGNING_KEY` | Injected by the Vercel↔Inngest integration |

### Local only (never set in staging/production)

| Variable      | Value | Notes                                                 |
| ------------- | ----- | ----------------------------------------------------- |
| `INNGEST_DEV` | `1`   | Points `/api/inngest` at the local Inngest dev server |

> **Rotating a calendar key later:** add `CALENDAR_TOKEN_KEY_V2`, set
> `CALENDAR_TOKEN_KEY_VERSION=2`, and keep `V1` so already-encrypted tokens stay
> readable. Never delete an old key version that still has data.

---

## 5. Databases — Neon (~10 min)

- [ ] Create a **separate Neon database/branch per environment** (staging DB ≠
      production DB).
- [ ] Put each connection string in that environment's `DATABASE_URL` (§4).
- [ ] Migrations run automatically inside `pnpm release:*` (expand-phase only).
      To run manually against an environment:
  ```bash
  MIGRATION_PHASE=expand DATABASE_URL="<env-db-url>" pnpm db:migrate
  ```
- [ ] After a deploy, sanity-check the schema landed:
  ```sql
  SELECT watch_channel_id FROM calendar_selection LIMIT 1;  -- column exists
  SELECT count(*) FROM calendar_sync_job;                   -- table exists
  ```

> Only **expand** migrations run automatically. A destructive/"contract"
> migration must ship in a separate, deliberate step — that's by design.

---

## 6. Inngest — background jobs (~5 min, mostly automatic)

With the Vercel↔Inngest integration installed (§1):

- [ ] Deploy the environment once. The integration auto-syncs `/api/inngest`.
- [ ] In the Inngest dashboard, confirm the functions appear for that
      environment. The event-driven core ones are `calendar-incremental-sync`,
      `calendar-event-export`, `account-data-export`, and
      `account-deletion-cleanup`; the rest are scheduled sweeps (outbox drains,
      watch renewal, reconciliation, mirror/export cleanup, timed task reminders,
      and `account-data-lifecycle-cleanup`).

Environment mapping is automatic:

- Vercel **Production** → Inngest **Production** environment.
- Vercel **`staging` custom environment** → its own Inngest environment.
- Vercel **Preview** → an Inngest **Branch environment**.

> **Throttling:** the provider-facing event functions (`calendar-incremental-sync`,
> `calendar-event-export`, `account-data-export`) are throttled so a burst cannot
> exhaust Google quotas or the database; excess runs queue rather than fail. No
> configuration is needed.

> **Cron caveat:** Inngest runs scheduled (cron) functions **only in
> Production**. So the outbox-drain sweeps, reconciliation, cleanup, and the
> retention purges do **not** run on staging. The main paths (webhook →
> incremental sync, request → export/deletion) work in both. On staging the
> drains are only a backstop for a rare failed dispatch, so this is fine.

> **Retention:** `account-data-lifecycle-cleanup` runs daily in production and
> purges metadata-only operational audit records once they pass their 90-day
> window (and completed deletion tombstones at 30 days). Nothing to configure.

---

## 7. Custom domain — required for live push notifications (~30 min + DNS wait)

Skip this and everything works **except** real-time Google push. Google refuses
to open a notification channel unless the webhook domain is verified via a DNS
TXT record — and you can't add DNS records to `*.vercel.app`.

For the environment that needs live push (production, and staging only if you
give it a real domain):

- [ ] Add the custom domain to the deployment: Vercel → Project → **Domains** →
      add `<your-domain>` → assign to the right environment/branch.
- [ ] Add the DNS record Vercel shows you (CNAME/A) **at your registrar's DNS**.
- [ ] Verify the domain in **Google Search Console**
      (`https://search.google.com/search-console`) → **Domain** property → add the
      **TXT record it gives you at your registrar's DNS** (this is a DNS record,
      not a Vercel env var).
- [ ] In Google Cloud → OAuth consent screen → **Authorized domains**, add the
      verified domain (it only accepts already-verified domains).
- [ ] Update `BETTER_AUTH_URL`, `NEXT_PUBLIC_APP_URL`, and `CALENDAR_WEBHOOK_URL`
      to the custom domain, and add its redirect URIs to the OAuth client (§3).

> DNS TXT and CNAME/A records live at your **domain registrar / DNS host** — never
> in Vercel's Environment Variables screen. Those are two different things.

---

## 8. Deploy

- [ ] **Staging:**
  ```bash
  pnpm release:staging
  ```
  Runs the full verify suite, pulls and **verifies the staging environment**
  (`APP_ENV=staging`), migrates (expand), and deploys to the `staging` custom
  environment (`vercel deploy --target=staging`).
- [ ] **Production:**
  ```bash
  pnpm release:production
  ```
  Runs verify, takes a **typed confirmation**, pulls and **verifies the
  production environment**, confirms Neon PITR retention (≥ 7 days), creates a
  verified Neon restore point, migrates (expand), then deploys to production.

Both scripts are fail-fast and never print secrets: a failed verify, a
mismatched `APP_ENV`, a missing variable, insufficient retention, or a failed
restore point stops the release before it touches anything. Read the first
failing line and fix that.

### Release rehearsal & restore drill (before launch)

- [ ] **Rehearsal — production readiness:**
  ```bash
  pnpm release:rehearsal
  ```
  Exercises the automated safeguards (seed disablement, expand-only migrations,
  the full verification command, environment documentation, preview isolation,
  and — when Neon credentials are present — PITR retention) and writes
  `docs/production-readiness.md` with pass/fail evidence and the remaining human
  launch dependencies. Exits non-zero if any automated check regressed.
- [ ] **Restore drill — recovery-time objective:**
  ```bash
  pnpm restore:drill
  ```
  Runs a real Neon point-in-time restore and reports the recovery time. Record
  it in `docs/runbooks/restore-drill.md`. The initial RTO is four hours. Run
  before launch and after meaningful schema changes.

---

## 9. Post-deploy verification (per environment)

- [ ] `/settings` loads without a 500 (proves `BETTER_AUTH_URL` matches the host).
- [ ] Sign in with Google succeeds (proves OAuth client + redirect URIs).
- [ ] **Settings → Calendars** → connect Google → pick a visible calendar
      (proves calendar OAuth + token encryption key).
- [ ] Load `/calendar` — imported events show; this also registers the watch.
      Confirm:
  ```sql
  SELECT google_calendar_id, watch_channel_id, watch_expires_at
  FROM calendar_selection WHERE watch_channel_id IS NOT NULL;
  ```
- [ ] (Push-enabled envs only) Change an event in Google Calendar → an Inngest run
      fires in the dashboard → reload `/calendar`, the change shows.
- [ ] (Analytics envs only) Change the theme or run a search → a content-free
      event (e.g. `theme_changed`, `search_performed`) appears in Umami. Confirm
      no event carries titles, URLs, or query text.
- [ ] **Vercel → Observability** shows request traces (via `@vercel/otel`) and the
      structured JSON logs carry `correlationId`/`jobId` with sensitive fields
      `[Redacted]`. Sentry is intentionally not used.

---

## Quick reference — what breaks when a var is wrong

| Symptom                                               | Likely cause                                                               |
| ----------------------------------------------------- | -------------------------------------------------------------------------- |
| `/settings` 500, log: `[Better Auth]: Invalid origin` | `BETTER_AUTH_URL` ≠ the host you're loading                                |
| Google sign-in → `redirect_uri_mismatch`              | Redirect URIs missing on the OAuth client (§3)                             |
| `/api/inngest` 500, "no signing key"                  | Inngest keys missing (locally: set `INNGEST_DEV=1`)                        |
| Calendar connect 500 / decrypt error                  | `CALENDAR_TOKEN_KEY_V1` missing or not 32-byte base64                      |
| `column ... does not exist` on any calendar page      | Migration didn't run for that DB (§5)                                      |
| Watches never register, no push notifications         | Domain not verified with Google (§7) — `*.vercel.app` can't be             |
| App 500s on boot in production                        | `OPERATIONAL_AUDIT_PSEUDONYM_SECRET` not set in Production (§4)            |
| No analytics events in Umami                          | `NEXT_PUBLIC_UMAMI_WEBSITE_ID` unset, or set to another env's website (§4) |

---

## Known limitations (by design, not bugs)

- Live Google push does not work on `*.vercel.app` — needs a verifiable custom
  domain (§7).
- The outbox-drain cron does not run on staging (Inngest runs crons in Production
  only, §6).
- UI convergence after a background sync is refetch-based (reload `/calendar` or
  wait for the periodic refetch) — there is no real-time push to the browser.
