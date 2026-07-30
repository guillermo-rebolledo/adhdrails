# ADR 0002 — Calm front-door direction: teaching empty states + one protected primary path

- Status: Accepted
- Date: 2026-07-29
- Issue: [MEM-53](https://linear.app/memoji-inc/issue/MEM-53)
- Builds on: [ADR 0001](0001-front-door-overhaul-is-ui-ux-only.md)

## Context

"Feels lost" is two problems: _not sure what to do_ (unclear primary action) and
_not sure what I can do_ (feature discoverability). The current Today stacks five
independent blocks — title, in-app reminder cues, Quick Capture, Focus Now (which
itself nests Energy, the recommendation, a deferral row, and a "Choose another
task" list), and a fully-expanded Available Tasks list — with no orientation for a
zero-data user. This must stay faithful to Rails' calm-focus principle: one
obvious action, suggestions without coercion, no hidden work, no guilt, no
overwhelm.

## Decision

**Scope.** Today page + app shell (as it affects orientation) + first-run
(zero-data) experience. Deep per-destination redesign of Tasks / Calendar / Inbox
internals is deferred.

**First-run orientation.** For a zero-data user, present one obvious "start here"
hero action (Quick Capture) and _teaching_ empty states — each empty section
quietly explains what will live there — instead of blank regions. No modal tour,
coach, or onboarding checklist (that would be a new feature and would violate
calm-focus). Discoverability comes from legible empty states plus the nav.

**Anti-clutter.** Protect one always-visible primary path — Quick Capture plus the
single Focus Now recommendation. Apply progressive disclosure to everything
secondary (collapse Available Tasks, keep "Choose another task" and deferral tucked
until asked for, render reminder cues only when there is something to cue) combined
with visual quieting (less card nesting, lighter weight on secondary sections) so
the eye lands on the primary action first.

**Process & grounding.** Audit the _running_ app (Today empty / populated /
mobile) and deliver a visual audit Artifact (annotated real screens vs. proposed
layout) for sign-off _before_ implementing. `/impeccable` structures the audit;
`/emil-design-eng` drives fine-grained polish and interaction taste.

## Consequences

- A first-time user gets one clear action and enough legible context to know what
  Rails is for, without a heavyweight onboarding flow.
- The populated Today reads calmer; secondary capability is still reachable, just
  not competing for attention.
- Because reminder cues and secondary sections become conditional/disclosed, the
  audit must verify nothing important becomes _undiscoverable_ (progressive
  disclosure, not removal).
