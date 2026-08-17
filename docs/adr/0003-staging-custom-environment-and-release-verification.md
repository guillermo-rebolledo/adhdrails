# ADR 0003 — Staging is a Vercel custom environment; releases verify their target

- Status: Accepted
- Date: 2026-07-29
- Issue: [MEM-52](https://linear.app/memoji-inc/issue/MEM-52) — [27] Automate and verify MVP releases

## Context

The MVP spec requires local, staging, preview, and production to be fully
isolated tiers with separate OAuth clients, databases, Inngest environments,
VAPID keys, analytics, and secrets, and requires that previews never receive
production access. It also requires fail-fast release scripts that verify the
intended environment before mutating anything, expand-contract migrations behind
a verified restore point, at least seven days of Neon point-in-time recovery, a
restore drill demonstrating a four-hour RTO, and a production-readiness report.

Staging was previously modelled as a **Preview** deployment of the `staging`
branch, aliased to a stable domain. That was a workaround for the Vercel Hobby
plan, which has no custom environments: staging shared the Preview variable scope
and could not be cleanly isolated from throwaway previews. The account is now on
**Vercel Pro**, which unlocks custom environments.

## Decision

- **Staging becomes a first-class Vercel custom environment** named `staging`
  with its own variable scope and its own stable domain. It is deployed with
  `vercel deploy --target=staging`, not by aliasing a Preview. Preview stays a
  separate tier for feature-branch deploys.
- **Each deployed tier carries an `APP_ENV` marker** (`staging` / `production`).
  It is the authoritative tier signal.
- **Release scripts pull the target environment and verify it before any
  mutation.** `assertReleaseEnvironment` (in `src/server/release/environment.ts`)
  refuses to proceed unless `APP_ENV` matches the release target and the isolated
  configuration is complete; production additionally requires the audit pseudonym
  secret and Neon credentials. Failures name the offending variable but never
  echo a secret value. `vercel env pull` loads the target into a private temp
  file that is parsed and deleted, so no secret reaches stdout or lingers.
- **Preview isolation is enforced at runtime.** `assertPreviewIsolation` runs in
  `src/instrumentation.ts` at boot and crashes a Preview that carries
  `APP_ENV=production`.
- **Production recovery is verified, not assumed.** `release:production` confirms
  Neon PITR retention is ≥ 7 days (`assertPitrRetention`) and creates a verified
  restore point before migrating. `pnpm restore:drill` (`runRestoreDrill`)
  exercises a real point-in-time restore and fails if it exceeds the four-hour
  RTO.
- **A release rehearsal produces a committed readiness report.**
  `pnpm release:rehearsal` (`scripts/production-readiness.ts`) exercises the
  automated safeguards and writes `docs/production-readiness.md` with pass/fail
  evidence and the remaining human launch dependencies. It never silently
  relaxes a check: an automated regression exits non-zero, and human
  dependencies (OAuth verification, restore drill) stay listed rather than
  auto-passed.

## Consequences

- Staging is genuinely isolated from previews and gains a stable, ownable domain;
  the Preview-alias workaround and its domain-repointing step are gone.
- Releasing requires the machine to be `vercel link`ed and authorized to pull the
  target environment — this is the same trust boundary a deploy already needs.
- Setting `APP_ENV=production` anywhere other than Production is now a loud
  failure, both at release time and at app boot, rather than a silent leak.
- The pure verification logic (environment, retention, restore drill, readiness)
  lives in `src/server/release/` under unit tests; the scripts stay thin
  orchestration over it.
