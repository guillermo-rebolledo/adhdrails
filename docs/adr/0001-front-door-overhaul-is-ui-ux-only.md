# ADR 0001 — The front-door overhaul is UI/UX only

- Status: Accepted
- Date: 2026-07-29
- Issue: [MEM-53](https://linear.app/memoji-inc/issue/MEM-53) (blocks [MEM-51](https://linear.app/memoji-inc/issue/MEM-51))

## Context

A first-time user lands on **Today** and feels lost: the page reads as cluttered,
and it is unclear both _what to do_ and _what Rails can do_. We want to fix that
felt experience before the MEM-51 accessibility/performance/motion audit, so the
audit targets the improved UI.

The concern is presentation and orientation, not capability. The MVP product,
domain, and architecture decisions in `docs/specs/rails-mvp.md` are settled.

## Decision

This effort changes **UI/UX only**. In-bounds:

- Rewriting copy, headings, empty-state and helper text.
- Typography, spacing, color, visual hierarchy, card/section styling, iconography.
- Re-laying-out and reordering existing elements, including editing existing
  components' JSX/Tailwind (not just page-level files).
- Collapsing / de-emphasizing existing sections (progressive disclosure).
- Designing first-run (zero-data) empty states using components and data that
  already exist.

Explicitly out-of-bounds:

- New features or data the app does not already have — notably the spec's
  not-yet-built Today **timeline**, which stays off the table.
- Domain logic, server, data-model, or behavior changes.
- New dependencies or new architectural patterns.
- Changing what the recommender, focus flow, or sync actually do.

## Consequences

- Fast, low-risk iteration confined to the presentation layer; no migrations,
  no domain/test churn beyond UI.
- Some spec-intended structure (e.g. the timeline) remains absent by design;
  de-cluttering works with what exists rather than completing the spec.
- If a clearly worthwhile improvement turns out to require structural change,
  it is captured as follow-up work, not smuggled into this pass.
