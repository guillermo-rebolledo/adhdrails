# Runbook — Neon restore drill (four-hour RTO)

Rails' initial recovery-time objective (RTO) is **four hours**: from a decision
to recover, production data can be restored to any point within the last seven
days (the PITR retention window) inside four hours. This drill proves that
objective is achievable and records the evidence.

Run the drill **before launch** and **after any meaningful schema change**.

## What the drill does

`pnpm restore:drill` (`scripts/restore-drill.ts` → `runRestoreDrill`) performs a
real point-in-time recovery against the production Neon project:

1. Creates a fresh read-only Neon branch from the production branch's history
   (Neon's PITR mechanism restores to the latest recoverable point).
2. Waits for the restore operation to finish, measuring elapsed time.
3. Fails if recovery does not complete within the four-hour objective.
4. Deletes the throwaway branch so the drill leaves no residue.

It prints the recovered branch id and the recovery time.

> **Scope:** the automated drill exercises Neon's PITR **control plane** —
> creating and completing a restore branch, and proving the timing is well inside
> the RTO. Because Neon branching is copy-on-write it is near-instant. Confirming
> the restored branch is actually **queryable** (the data plane) is the manual
> step below; do it as part of each recorded drill.

## Prerequisites

Set these for the production Neon project (also used by `release:production`):

- `NEON_API_KEY` — a Neon API key scoped to the production project.
- `NEON_PROJECT_ID` — the production project id.
- `NEON_BRANCH_ID` — the production branch id (`br-…`).

Retention itself is verified separately: `pnpm release:rehearsal` (and every
`pnpm release:production`) confirms Neon reports **≥ 7 days** of PITR history.

## Steps

1. Confirm retention: `pnpm release:rehearsal` reports the Neon PITR retention in
   `docs/production-readiness.md` (must be ≥ 7 days).
2. Run the drill:
   ```bash
   pnpm restore:drill
   ```
3. Read the reported recovery time. It must be well under four hours (a healthy
   Neon restore is minutes).
4. **Verify the data plane manually:** in the Neon console, open the restore
   branch created by the drill (or create a short-lived one if cleanup already
   removed it), connect, and spot-check a couple of tables return rows. This
   confirms the restore is queryable, not just that the operation reported
   `finished`.
5. Record the result in the log below.

## Real-incident recovery (beyond the drill)

The drill restores to the _latest_ recoverable point. During a real incident you
usually want a specific instant _before_ the bad change:

1. In the Neon console (or API), create a branch from the production branch with
   a `parent_timestamp` just before the incident.
2. Verify the restored data (spot-check the affected tables).
3. Promote the restored branch to become production, or repoint `DATABASE_URL`
   at it, then redeploy. Treat this as a production change: take a fresh restore
   point first and follow `pnpm release:production`.

## Drill log

Record each drill run. Keep the most recent at the top.

| Date (UTC)            | Recovery time | Retention at run | Run by | Notes                                                        |
| --------------------- | ------------- | ---------------- | ------ | ------------------------------------------------------------ |
| _pending first drill_ |               |                  |        | Run `pnpm restore:drill` against production and record here. |
