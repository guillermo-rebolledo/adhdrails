# Git worktrees

Use one Git worktree per Linear issue so concurrent work has separate files,
indexes, and branches.

## Meaning of “create a worktree”

When asked to create a worktree for an issue, the agent must:

1. Read the Linear issue, including its identifier, title, status, and comments.
2. Fetch the latest remote refs with `git fetch origin`.
3. Resolve the branch and directory names using the rules below.
4. Check `git worktree list` and local and remote branch refs before creating
   anything.
5. Create the worktree from the correct ref.
6. Report the issue, branch, base ref, and absolute worktree path.

Creating a worktree does not authorize the agent to implement the issue, copy
secrets, install dependencies, remove another worktree, or delete a branch.

The current worktree does not need to be clean. Its tracked and untracked
changes remain isolated and must not be stashed, committed, reset, or moved as
part of creating another worktree.

## Standard command

Use the repository script for normal worktree creation:

```bash
pnpm worktree:create <name-or-branch> [base-ref]
```

For example:

```bash
pnpm worktree:create MEM-123-add-reminders
pnpm worktree:create MEM-123-add-reminders staging
pnpm worktree:create codex/mem-123-add-reminders origin/main
```

The name is lowercased automatically. A bare name receives the `gortizdev/`
branch prefix. Passing a full branch name preserves its prefix. The base
defaults to `staging`; an unqualified base prefers the freshly fetched
`origin/<base>`.

The script implements the naming, path resolution, fetch, collision checks,
existing-branch handling, creation, and verification rules below. Use the
manual commands only when diagnosing a failure or handling an explicit case
the script does not support.

## Naming

Worktrees live outside the primary checkout in a single sibling directory:

```text
<primary-checkout-parent>/adhdrails-worktrees/<issue-id>-<slug>
```

Use the lowercase Linear issue identifier and a short kebab-case title slug:

```text
/Users/example/dev/adhdrails-worktrees/mem-123-add-reminders
```

Use this branch name:

```text
gortizdev/<issue-id>-<slug>
```

For example:

```text
gortizdev/mem-123-add-reminders
```

Keep the slug concise, recognizable, and stable. Do not rename an existing
branch or worktree merely because a different slug would now be preferable.

If the Linear issue or an existing remote branch establishes a branch name,
reuse that exact branch name. Existing refs take precedence over generating a
new name.

## Base branch

New issue branches start from the freshly fetched `origin/staging`, unless the
user or Linear issue explicitly names another base branch.

Never base a new issue worktree on the currently checked-out issue branch by
accident. Do not use bare `HEAD` as the base.

## Resolving the primary checkout

The command may be run from the primary checkout or from any existing
worktree. Resolve the primary checkout from Git's common directory:

```bash
primary_checkout="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
worktree_root="$(dirname "$primary_checkout")/adhdrails-worktrees"
```

Validate the resolved paths before creating or removing anything. Do not
repurpose `HOME`, `CODEX_HOME`, or another environment variable for these
paths.

## Creation cases

Before creation:

```bash
git fetch origin
git worktree list
git show-ref --verify --quiet "refs/heads/$branch"
git show-ref --verify --quiet "refs/remotes/origin/$branch"
```

Choose exactly one case:

### The branch does not exist

Create a new local branch from `origin/staging`:

```bash
mkdir -p "$worktree_root"
git worktree add -b "$branch" "$worktree_path" origin/staging
```

### The branch exists only on `origin`

Create a tracking branch in the new worktree:

```bash
mkdir -p "$worktree_root"
git worktree add --track -b "$branch" "$worktree_path" "origin/$branch"
```

### The branch already exists locally

Attach the existing local branch:

```bash
mkdir -p "$worktree_root"
git worktree add "$worktree_path" "$branch"
```

If `git worktree list` shows that the branch is already attached, do not try to
attach it again. Report its existing path and use that worktree if the user's
request permits it.

If the intended path exists and is non-empty, stop and report the collision.
Do not use `--force`, delete the directory, or silently choose a second name.

## After creation

Verify the result:

```bash
git -C "$worktree_path" status --short --branch
git worktree list
```

Do not copy `.env` files, credentials, build output, or ignored files from
another worktree. If implementation later requires local configuration, report
what is missing and follow the repository's setup documentation.

Dependency directories are worktree-local. Install dependencies only when the
user has also asked to begin work and installation is necessary.

## Cleanup

Removing a worktree or deleting its branch requires an explicit cleanup
request. Before removal, inspect its status and confirm that no uncommitted or
unpushed work will be lost.

Use:

```bash
git worktree remove "$worktree_path"
```

Do not delete the directory manually and do not use `--force`. Delete the
local branch only when its work is safely integrated or the user explicitly
asks to discard it:

```bash
git branch -d "$branch"
```

Use `git worktree prune` only to clean stale metadata after confirming the
referenced directories truly no longer exist.
