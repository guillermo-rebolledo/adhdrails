#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  pnpm worktree:create <name-or-branch> [base-ref]

Examples:
  pnpm worktree:create MEM-123-add-reminders
  pnpm worktree:create MEM-123-add-reminders staging
  pnpm worktree:create codex/mem-123-add-reminders origin/main

Bare names are lowercased and use the gortizdev/ branch prefix.
The base defaults to staging. An unqualified base prefers origin/<base>.
EOF
}

if [[ $# -lt 1 || $# -gt 2 ]]; then
  usage >&2
  exit 2
fi

name_or_branch="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
base_input="${2:-staging}"

if [[ "$name_or_branch" == */* ]]; then
  branch="$name_or_branch"
  worktree_name="${name_or_branch##*/}"
else
  branch="gortizdev/$name_or_branch"
  worktree_name="$name_or_branch"
fi

if ! git check-ref-format --branch "$branch" >/dev/null 2>&1; then
  printf 'Invalid branch name: %s\n' "$branch" >&2
  exit 2
fi

if [[ ! "$worktree_name" =~ ^[a-z0-9]+([._-][a-z0-9]+)*$ ]]; then
  printf 'Invalid worktree name: %s\n' "$worktree_name" >&2
  exit 2
fi

if [[ -z "$base_input" || "$base_input" == -* ]]; then
  printf 'Invalid base ref: %s\n' "$base_input" >&2
  exit 2
fi

git rev-parse --is-inside-work-tree >/dev/null

common_dir="$(git rev-parse --path-format=absolute --git-common-dir)"
primary_checkout="$(dirname "$common_dir")"
worktree_root="$(dirname "$primary_checkout")/adhdrails-worktrees"
worktree_path="$worktree_root/$worktree_name"

printf 'Fetching origin...\n'
git fetch origin

attached_path=""
current_path=""
while IFS= read -r line; do
  case "$line" in
    "worktree "*)
      current_path="${line#worktree }"
      ;;
    "branch refs/heads/$branch")
      attached_path="$current_path"
      break
      ;;
  esac
done < <(git worktree list --porcelain)

if [[ -n "$attached_path" ]]; then
  printf 'Branch %s is already attached at:\n%s\n' "$branch" "$attached_path"
  exit 0
fi

if [[ -e "$worktree_path" ]]; then
  if [[ ! -d "$worktree_path" || -n "$(find "$worktree_path" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
    printf 'Worktree path already exists and is not empty: %s\n' "$worktree_path" >&2
    exit 1
  fi
fi

mkdir -p "$worktree_root"

if git show-ref --verify --quiet "refs/heads/$branch"; then
  source_description="existing local branch $branch"
  git worktree add "$worktree_path" "$branch"
elif git show-ref --verify --quiet "refs/remotes/origin/$branch"; then
  source_description="existing remote branch origin/$branch"
  git worktree add --track -b "$branch" "$worktree_path" "origin/$branch"
else
  if git show-ref --verify --quiet "refs/remotes/origin/$base_input"; then
    base_ref="origin/$base_input"
  elif git rev-parse --verify --quiet "$base_input^{commit}" >/dev/null; then
    base_ref="$base_input"
  else
    printf 'Base ref does not resolve to a commit: %s\n' "$base_input" >&2
    exit 1
  fi

  source_description="new branch from $base_ref"
  git worktree add -b "$branch" "$worktree_path" "$base_ref"
fi

printf '\nCreated worktree\n'
printf '  Branch: %s\n' "$branch"
printf '  Source: %s\n' "$source_description"
printf '  Path:   %s\n' "$worktree_path"
printf '\nNext:\n  cd %q\n' "$worktree_path"

git -C "$worktree_path" status --short --branch
