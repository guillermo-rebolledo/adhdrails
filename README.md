# Rails

Rails is a calm-focus productivity app for independent knowledge workers with
ADHD. This repository is a single-package Next.js App Router application; it is
not a Ruby on Rails project.

## Local development

Requirements:

- Node.js 24 or newer
- Corepack
- Docker (used for the ephemeral PostgreSQL acceptance database)
- A local or development Neon PostgreSQL connection

```sh
corepack enable
pnpm install
pnpm exec playwright install
cp .env.example .env.local
pnpm db:migrate
pnpm db:seed
pnpm dev
```

The seed is deterministic and idempotent. It refuses to run when `APP_ENV`,
`NODE_ENV`, or `VERCEL_ENV` is `production`.

## Health and verification

`GET /api/v1/health` checks both the application and PostgreSQL. A healthy
response is safe to expose to deployment monitors. Database failures return a
generic Problem Details response with a correlation ID; connection details are
never returned.

Run the complete local quality gate before opening a pull request:

```sh
pnpm verify
```

This checks formatting, ESLint (including the TanStack Query rules), strict
TypeScript, Vitest, a real ephemeral PostgreSQL database, Playwright in
Chromium/Firefox/mobile WebKit, the production build, and Lighthouse budgets.

Generate a local Turbopack bundle report separately when investigating bundle
size:

```sh
pnpm analyze
```

## Deployment environments

Vercel hosts the application. Development, stable staging, and production must
use separate Neon databases and environment variables. Link the checkout to the
Vercel project, create a custom `staging` environment that tracks the staging
branch, and configure `DATABASE_URL` independently in each environment.

Production also requires `NEON_API_KEY`, `NEON_PROJECT_ID`, and
`NEON_BRANCH_ID`. The production release creates a Neon restore-point snapshot
before applying expand-compatible migrations. Contract migrations must ship in
a later release.

```sh
pnpm release:staging
pnpm release:production
```

The production command runs the full release check and requires the exact typed
confirmation `release Rails to production` before deploying.
