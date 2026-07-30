# MEM-51 — Accessibility, performance, and motion audit

- Issue: [MEM-51](https://linear.app/memoji-inc/issue/MEM-51) — [26] Audit accessibility, performance, and motion
- Parent: [MEM-25 — Rails MVP spec](https://linear.app/memoji-inc/issue/MEM-25)
- Date: 2026-07-29
- Baseline commit: `9fa2bf0`

This is the recorded evidence for the MVP audit pass. It captures how each
acceptance criterion is verified, the standing configuration that keeps it
verified in CI, the animation audit, and the regressions fixed along the way.
Accessibility and performance are product pillars, not a cleanup phase — so most
of the enforcement already lives in the suite; this pass closed the gaps.

## How to reproduce the evidence

| Evidence                               | Command           |
| -------------------------------------- | ----------------- |
| Full local verification                | `pnpm verify`     |
| Cross-browser journeys + axe           | `pnpm test:e2e`   |
| Lighthouse budgets (a11y / perf / CLS) | `pnpm lighthouse` |
| Bundle analysis                        | `pnpm analyze`    |
| Domain + component + integration       | `pnpm test`       |

## Cross-browser journeys (AC 1)

`playwright.config.ts` runs every `e2e/` journey across three engines and form
factors: `chromium` (desktop Chrome), `firefox` (desktop Firefox), and
`webkit-mobile` (iPhone 13). Tests serve a production build, so navigation is
deterministic (no dev-server HMR flakiness).

Representative states already exercised by the suite:

- **Offline / reconnect** — `quick-capture.spec.ts`, `tasks.spec.ts` (capture
  offline, queue, reconnect, sync).
- **Timezone / locale** — session bootstrap accepts `timezone` and `locale`
  (`e2e/support/session.ts`); calendar/agenda specs assert wall-clock intent.
- **Theme** — `application-shell.spec.ts` selects Light/Dark/System and asserts
  the `html` class.
- **Permission states** — `notifications.spec.ts` covers granted / denied /
  unsupported fallbacks.
- **Narrow mobile** — `inbox.spec.ts` and others pin a 375×812 viewport.
- **Keyboard-only** — `inbox.spec.ts`, `onboarding.spec.ts`, `command-menu.spec.ts`.
- **Reduced motion** — new `reduced-motion.spec.ts` (see below).

Engine-agnostic UI flows are gated to one representative engine with an explicit
`test.skip` note; API round-trips and rendering-sensitive assertions stay
cross-browser.

## Accessibility — WCAG 2.2 AA (AC 2)

Automated axe coverage runs with the full ruleset
(`wcag2a wcag2aa wcag21a wcag21aa wcag22aa`) and asserts zero violations.

**Already covered:** application shell (Light + Dark), tasks, focus, calendar,
calendar-connection, settings, search, command menu.

**Added in this pass:**

- `inbox.spec.ts` — Inbox while processing items.
- `onboarding.spec.ts` — the onboarding flow.
- `thoughts.spec.ts` — Thoughts list and detail.

Manual review checklist (WCAG 2.2 AA), to be walked before launch on real
assistive tech — the automated pass narrows but does not replace it:

- [ ] Screen reader (VoiceOver / NVDA): landmarks, names, roles, and status
      announcements on capture, focus, Inbox badge, and Undo.
- [ ] Keyboard-only traversal of every destination; visible focus; logical
      order; focus restoration after dialogs/drawers close.
- [ ] 200% zoom and 400% reflow without loss of content or function.
- [ ] Contrast in both themes (semantic tokens in `globals.css`).
- [ ] Reduced motion: no spatial movement, both themes readable.
- [ ] Notification-denied / unsupported fallback remains operable.

## Core Web Vitals and acknowledgement latency (AC 3, 4)

Targets at the 75th percentile: **LCP ≤ 2.5s, INP ≤ 200ms, CLS ≤ 0.1**.

- `lighthouserc.json` enforces `accessibility: 1.0`, `best-practices ≥ 0.95`,
  `performance ≥ 0.9`, and `cumulative-layout-shift ≤ 0.1` on `/today` as part
  of `pnpm verify`. Field p75 is monitored in production via Vercel Speed
  Insights; Lighthouse CI is the local proxy.
- **Local acknowledgement ≤ 100ms** — capture and focus actions are optimistic
  through the Dexie command layer + `useLiveQuery`, decoupled from the network.
  Focus start/pause/resume/complete and capture are acknowledged from local
  state; server persistence follows asynchronously. Exercised by the focus and
  quick-capture journeys.

## Motion audit (AC 5) — improve-animations, read-only

The motion surface is small and **CSS-only**: no `motion` package is in use.
Transitions are Tailwind utilities + `tw-animate-css` keyframes on Base UI
overlays. Audited against the eight improve-animations categories.

Findings and dispositions (all approved fixes are CSS — Motion was not needed;
it stays reserved for meaningful, interruptible continuity per the spec):

| Severity | Category      | Location                                                                                     | Finding                                                                        | Fix                                                          |
| -------- | ------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| HIGH     | Performance   | `ui/button.tsx`                                                                              | `transition-all` on the most-pressed element animates layout props off the GPU | scoped to `transition` (GPU-safe property set)               |
| MEDIUM   | Accessibility | `ui/sheet.tsx`, `ui/drawer.tsx`, `ui/tooltip.tsx`, `ui/dropdown-menu.tsx`, `ui/combobox.tsx` | slide/zoom/translate with no reduced-motion guard                              | global spatial-token neutralization + `motion-reduce` guards |
| LOW      | Performance   | `ui/sidebar.tsx`                                                                             | `transition-all ease-linear` rail animated `left/right` insets                 | scoped to `transition-colors`                                |

Already correct — no findings: command-menu and focus-session are reduced-motion
aware; Base UI popovers scale from their trigger via `--transform-origin`;
overlays use `zoom-in-95` (never `scale(0)`); the button has subtle
`translate-y-px` press feedback; no `ease-in` on UI.

## Reduced motion (AC 6)

Motion-sensitive users (user story 124) get spatial movement substituted with
plain fades while both themes stay readable.

- **Global guard** (`globals.css`): under `prefers-reduced-motion: reduce`, the
  `tw-animate-css` enter/exit spatial inputs (`--tw-enter/exit-translate-*`,
  `-scale`, `-rotate`) are reset to neutral with `!important`. The `fade-*`
  opacity component is left intact, so tooltips, dropdowns, the combobox, and
  any keyframed overlay cross-fade in place instead of sliding or zooming.
- **Component guards**: sheet and drawer transforms are transition-driven (not
  keyframe-driven), so they carry `motion-reduce:transition-none` to appear in
  place. Command-menu and focus-session already had guards.
- **Coverage**: `reduced-motion.spec.ts` emulates the preference and asserts the
  neutralized spatial tokens, a transition-free command menu, and zero axe
  violations in both Light and Dark.

## Recorded artifacts and fixtures (AC 7)

- **Lighthouse** — `pnpm lighthouse`, config in `lighthouserc.json`, output to
  `.lighthouseci/`.
- **Bundle analysis** — `pnpm analyze` (`next experimental-analyze`).
- **Long-list / agenda fixtures** — deterministic factories + `pnpm db:seed`
  create realistic multi-timezone, multi-sync-state data; agenda `Later` uses
  cursor pagination (20 initial + Load more) validated by the calendar specs.
- **Accessibility evidence** — axe assertions across the specs above; manual
  checklist recorded here.
- **Fixed regressions** — see below.

## Regressions fixed in this pass

- **Destructive button contrast (WCAG AA).** The soft destructive variant
  (`bg-destructive/10` + `text-destructive`, e.g. "Delete Thought") measured
  ~4.1:1 in light mode — below the 4.5:1 AA threshold. Surfaced by the new
  Thoughts axe check across all three engines. Darkened the light-mode label to
  `color-mix(in oklch, var(--destructive), black 15%)` (≈5.9:1) and restored the
  lighter token in dark mode, which already passed on its deeper tint.
- **`today-sections.tsx` — `react-hooks/set-state-in-effect` lint error.** The
  "has ever had a Task" latch used a `setState` inside `useEffect`, which the
  React Compiler ruleset rejects (cascading renders). Rewrote it as state
  adjusted during render — React's endorsed alternative — removing the effect.
- **`transition-all` on button and sidebar rail** animated layout properties off
  the GPU (see motion audit). Scoped to GPU-safe property sets.
