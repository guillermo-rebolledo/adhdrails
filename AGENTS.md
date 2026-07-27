## Agent skills

### Issue tracker

Issues are tracked in the Rails project in Linear. See `docs/agents/issue-tracker.md`.

### Git worktrees

When asked to create, use, inspect, or remove a worktree, follow
`docs/agents/worktrees.md`.

Create an issue worktree with:

```bash
pnpm worktree:create <name-or-branch> [base-ref]
```

The base ref defaults to `origin/staging`.

### Triage labels

Linear labels use the default five-role triage vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

Domain documentation uses the single-context layout. See `docs/agents/domain.md`.

### MVP specification

Before planning or implementing product work, read `docs/specs/rails-mvp.md`. Treat its product behavior, architecture boundaries, testing decisions, and out-of-scope list as the MVP source of truth.
