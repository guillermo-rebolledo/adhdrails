# Rails — Calm Focus MVP Product and Technical Specification

## Problem Statement

Independent knowledge workers with ADHD often know that they have important work to do but struggle to capture competing thoughts, understand time-bound commitments, choose a realistic next action, and begin without becoming overwhelmed. Conventional task managers expose too many choices, treat estimates like promises, punish overdue work, and separate tasks from the calendar context needed to make a good decision.

Users need a calm, low-stimulation system that continually answers two questions:

> What should I do now, and what must I remember today?

The system must work equally well on desktop and mobile, remain useful without Google Calendar access, degrade safely when browser capabilities are unavailable, and preserve essential capture and focus workflows while offline.

## Solution

Rails is a responsive, privacy-conscious productivity web app for adults with ADHD. It combines frictionless capture, a weekly agenda, Google Calendar interoperability, deterministic task recommendations, energy-aware ordering, one active focus session, browser reminders for timed tasks, and lightweight organization through Tasks, Thoughts, Areas, and an Inbox.

Rails provides one obvious primary action at a time. It suggests without taking control, explains recommendations briefly, keeps unscheduled work visible, and avoids streaks, scores, guilt, punitive overdue states, and automatic scheduling. Google Calendar remains authoritative for connected calendar events, while Rails remains authoritative for tasks, thoughts, focus sessions, and app preferences.

The MVP is free for any adult with a Google account. Google Calendar authorization is strongly recommended but optional and separate from login. The product provides a complete fallback experience when Calendar access is absent or revoked.

## User Stories

1. As an adult with a Google account, I want to sign in with Google, so that I can start using Rails without creating another password.
2. As a new user, I want onboarding to be short and seamless, so that setup does not become another task I abandon.
3. As a new user, I want Calendar permission requested separately from login, so that I understand what access I am granting.
4. As a privacy-conscious user, I want to use Rails without granting Google Calendar access, so that Calendar access is not a condition of using the product.
5. As a Calendar-connected user, I want to choose which calendars are visible, so that my agenda contains the commitments relevant to me.
6. As a Calendar-connected user, I want to choose one writable calendar, so that Rails always has an unambiguous destination for new events.
7. As a user with shared calendars, I want to view events from selected shared calendars, so that I can understand my full schedule.
8. As a user with read-only calendars, I want Rails to prevent writes to them, so that failed or unauthorized changes are avoided.
9. As a user, I want Rails to infer my timezone from my primary Google Calendar, so that scheduled items initially appear at the expected time.
10. As a traveler or remote worker, I want to edit my account timezone, so that Rails can represent my current planning context.
11. As a user, I want imported events to preserve their original timezone meaning, so that synchronization does not shift commitments unexpectedly.
12. As a user, I want interface copy in English while dates and times follow my locale, so that formatting remains familiar.
13. As a user, I want the Today screen to show one clear primary action, so that I do not have to evaluate many competing choices.
14. As a user with a thought in mind, I want to capture it in seconds, so that I can return to what I was doing.
15. As a user, I want Quick Capture available directly on Today, so that capture does not require navigation.
16. As a user anywhere in the app, I want a persistent capture action, so that I never have to hunt for an input.
17. As a keyboard user, I want to open the command menu with Command or Control plus K, so that navigation and creation are fast.
18. As a keyboard user, I want the command menu to offer C for Capture, T for New Task, E for New Event, and N for New Thought, so that shortcuts remain discoverable without conflicting with browser commands.
19. As a mobile user, I want a visible control that opens the same command experience full-screen, so that keyboard access is not required.
20. As a user, I want natural-language capture to recognize conservative dates, times, and durations, so that common scheduling details are preserved.
21. As a user, I want detected details represented as editable chips, so that I can correct the parser before classification.
22. As a user, I want an explicit notice when no schedule is detected, so that I do not assume the parser understood something it missed.
23. As a user, I want uncertain input saved safely to the Inbox, so that capture never fails merely because classification is unclear.
24. As a user, I want full-page creation flows instead of modals or drawers, so that entry is reliable on small screens and with mobile keyboards.
25. As a user composing an item, I want a device-local draft saved without slowing input, so that navigation or interruption does not destroy my work.
26. As a user, I want new Inbox items marked unseen, so that I know something awaits review.
27. As a user, I want the Inbox indicator to be a numberless red badge, so that it informs me without creating pressure.
28. As a screen-reader user, I want the unseen Inbox state announced accessibly, so that the indicator is not visual-only.
29. As a user opening the Inbox, I want its items marked seen, so that the badge represents new material since my last visit.
30. As a user processing an Inbox item, I want to classify it as a Task, Event, or Thought, so that captured material can become useful.
31. As a user, I want to skip an Inbox item without penalty, so that I am never forced into Inbox Zero.
32. As a user, I want to delete an app-owned Inbox item with Undo, so that accidental deletion is recoverable.
33. As a user, I want recognized schedule and duration details carried into classification, so that I do not repeat work.
34. As a user, I want to convert between Task, Thought, and Event with explicit consequences, so that I can correct an item safely.
35. As a user, I want a Task to require only a title, so that organization never blocks capture.
36. As a user, I want to mark a Task as Important, so that meaningful work can influence recommendations.
37. As a user, I want optional Low, Medium, or High energy metadata, so that flexible work can match my current capacity.
38. As a user, I want Tasks without energy metadata treated as suitable for Any energy, so that incomplete metadata never hides work.
39. As a user, I want optional estimates to remain informative, so that an estimate does not become a deadline or source of guilt.
40. As a user, I want a calm notice when a focus session reaches its estimate, so that I can reassess without being told I failed.
41. As a user, I want an optional Area selected through a searchable combobox, so that I can add lightweight context.
42. As a user, I want to create an Area directly from the combobox when it does not exist, so that organization stays in flow.
43. As a user, I want each Task to have at most one Area in the MVP, so that categorization remains simple.
44. As a user, I want to schedule a Task for a date without implying a deadline, so that planning language remains non-punitive.
45. As a user, I want a date-only scheduled Task to appear without creating a timed browser reminder, so that unspecified time is respected.
46. As a user, I want a timed Task to receive configurable browser reminders, so that time-sensitive work is harder to miss.
47. As a user, I want Tasks organized into Today, Upcoming, All, and Completed views, so that I can inspect the scope I need.
48. As a user, I want Anytime to show all Tasks rather than only unscheduled Tasks, so that it is a complete browsing view.
49. As a user, I want unscheduled Tasks to remain visible, so that flexible work does not disappear.
50. As a user, I want to search and filter Tasks by Area and energy, so that I can narrow a large list intentionally.
51. As a user, I want to set my current energy to Low, Medium, High, or Not set, so that recommendations can reflect my capacity.
52. As a user, I want my temporary energy selection to expire after roughly three hours, so that an old state does not silently shape later recommendations.
53. As a user, I want energy to reorder flexible work but never hide it, so that metadata does not remove my control.
54. As a user, I want scheduled commitments unaffected by energy, so that capacity does not conceal fixed obligations.
55. As a user, I want Rails to recommend one Task at a time, so that choosing feels manageable.
56. As a user, I want the recommendation to explain itself briefly, so that I can understand why it fits.
57. As a user, I want recommendations based on deterministic rules, so that behavior is predictable and testable.
58. As a user, I want to select a different Task manually, so that Rails never decides for me.
59. As a user, I want to defer flexible work until Later today, Tomorrow, or a chosen date, so that I can make a concrete decision without deleting it.
60. As a user, I want only one active focus session across my account, so that my attention is not split between simultaneous timers.
61. As a user, I want to start, pause, resume, and complete a focus session, so that the session follows real interruptions.
62. As a user, I want the active session persisted on the server, so that closing or changing devices does not silently lose it.
63. As a user, I want focus actions acknowledged locally within 100 milliseconds, so that the interface feels immediate.
64. As a user, I want a count-up timer rather than a countdown, so that an estimate does not become pressure.
65. As a user, I want an expanded low-distraction focus view, so that unrelated interface elements recede while I work.
66. As a user, I want returning to Today not to pause my session, so that navigation does not change focus state.
67. As a user, I want to capture a distraction during focus with one short entry, so that I can let it go without changing contexts.
68. As a user, I want captured distractions saved as Inbox items with a subtle confirmation, so that I trust they will be available later.
69. As a user, I want Pause to preserve elapsed time and captured distractions, so that interruption does not erase progress.
70. As a user, I want Move to later distinct from Pause, so that postponing a Task is an explicit planning action.
71. As a user completing a Task, I want a calm acknowledgment and a brief Undo opportunity, so that completion feels supportive and recoverable.
72. As a user completing a Task, I want Return to Today as the primary next action, so that another Task never starts automatically.
73. As a user completing a Task, I want View next items as a secondary action, so that I can deliberately choose what follows.
74. As a user viewing next items, I want today’s remaining events and scheduled Tasks first, followed by available unscheduled Tasks, so that time-sensitive context stays clear.
75. As a user with nothing appropriate to focus on, I want a calm empty state, so that Rails does not manufacture urgency.
76. As a Calendar-connected user, I want selected Google events imported into my agenda, so that Rails reflects my real commitments.
77. As a Calendar-connected user, I want changes synchronized in both directions, so that edits remain consistent between Rails and Google Calendar.
78. As a Calendar-connected user, I want Google Calendar to win event conflicts, so that there is one predictable event authority.
79. As a Calendar-connected user, I want a visible pending or stale state while synchronization is incomplete, so that I do not mistake old data for current data.
80. As a user returning online, I want queued changes synchronized automatically and safely retried, so that offline work is not lost.
81. As a user with a failed sync, I want my local unsynchronized change retained for review, so that conflict handling does not discard my input.
82. As a user, I want duplicate synchronization requests handled idempotently, so that retries do not create duplicate records or events.
83. As a user creating an Event, I want a default 30-minute duration, so that common entry is fast.
84. As a user, I want Event start and end semantics compatible with Google Calendar, so that synchronization requires no lossy translation.
85. As a user, I want imported all-day events displayed, so that my agenda is complete.
86. As a user, I want all-day event creation deferred rather than approximated incorrectly, so that MVP behavior remains trustworthy.
87. As a user, I want imported recurring events displayed accurately, so that repeating commitments appear in Rails.
88. As a user, I want recurring-series edits directed to Google Calendar, so that Rails does not partially implement recurrence.
89. As a user, I want a timed capture treated as tentative until I confirm its type, so that Rails does not create an unintended Google event.
90. As a user, I want timeline and reminders to reflect a tentative timed item immediately, so that capture still protects the commitment.
91. As a user, I want a Task exported to Google only when I explicitly convert it to an Event, so that tasks do not pollute my calendar.
92. As a user without Calendar access, I want to create local Events, so that the Calendar section remains functional.
93. As a user reconnecting Calendar later, I want to choose whether to export local Events, so that reconnection does not cause surprise writes.
94. As a user who revokes Calendar access, I want login to continue working, so that removing an integration does not remove my account.
95. As a user who disconnects Calendar, I want a clear fallback experience rather than broken controls, so that the product remains usable.
96. As a user, I want the Calendar screen scoped to a weekly agenda, so that I can understand the near future without an overwhelming grid.
97. As a desktop user, I want a clear seven-day weekly agenda, so that I can compare commitments across the week.
98. As a mobile user, I want a vertical seven-day agenda, so that the complete Calendar experience remains usable on a narrow screen.
99. As a user, I want items scheduled beyond the current week visible in a separate Later list, so that future work remains discoverable without crowding the agenda.
100. As a user, I want Later grouped by month and loaded in batches, so that long-range browsing remains fast.
101. As a user, I want past items available through search rather than continuously rendered, so that current views remain lightweight.
102. As a user, I want the Today timeline to contain only events and timed Tasks, so that it accurately represents time.
103. As a user, I want untimed Tasks available in a lower-emphasis collapsed section, so that they remain accessible without competing with commitments.
104. As a user, I want Google to remain responsible for event notifications, so that duplicate alerts do not make me disable Rails notifications.
105. As a user, I want Rails responsible for timed Task notifications, so that tasks receive reminders without becoming calendar events.
106. As a user, I want an optional in-app event cue 15 minutes before an event, so that Rails can support awareness without duplicating system notifications.
107. As a user, I want notification permission requested contextually, so that I understand its value before the browser prompt appears.
108. As a user, I want Rails to detect browser notification support, so that unsupported controls are not shown.
109. As a user on an unsupported or denied browser, I want in-app reminder fallback, so that core planning remains available.
110. As a user, I want a notification master switch and configurable timed-Task lead time, so that reminders fit my preferences.
111. As a user, I want to enable or disable at-time Task reminders and in-app event cues separately, so that I can avoid unwanted interruption.
112. As a user, I want a Test notification action, so that I can verify my browser and operating-system setup.
113. As a user with multiple devices, I want each browser subscription managed separately, so that I control where notifications arrive.
114. As a user, I want global search across Tasks, Thoughts, Inbox items, and navigation, so that I can reach information quickly.
115. As a user, I want forgiving partial and typo-tolerant search, so that exact wording is not required.
116. As an offline user, I want local search over synchronized content, so that lookup still works without a connection.
117. As a user, I want Thoughts to provide lightweight non-actionable reference storage, so that ideas do not masquerade as tasks.
118. As a user, I want Thoughts searchable and individually viewable, so that captured reference material remains useful.
119. As a mobile user, I want a full-screen navigation drawer with Today, Inbox, Tasks, Calendar, Thoughts, Search, and Settings, so that every function is reachable.
120. As a desktop user, I want a full collapsible sidebar with the same navigation, so that orientation remains stable without wasting space.
121. As a user, I want Light, Dark, and System appearance options, so that Rails fits my environment.
122. As a user, I want System appearance selected by default, so that setup requires no visual preference decision.
123. As a low-vision user, I want both themes to meet accessible contrast requirements, so that appearance choices do not reduce readability.
124. As a motion-sensitive user, I want reduced-motion preferences honored throughout the app, so that animation does not cause discomfort.
125. As a user, I want restrained, interruptible motion that communicates cause and continuity, so that interactions feel responsive without becoming distracting.
126. As a keyboard user, I want visible focus, logical tab order, and complete keyboard access, so that every workflow is operable without a pointer.
127. As a screen-reader user, I want semantic landmarks, names, states, and status announcements, so that Rails is understandable non-visually.
128. As a user on a slower device or network, I want good Core Web Vitals and immediate local interactions, so that the interface does not become another source of friction.
129. As a user, I want reversible app-owned deletion with a 10-second Undo window, so that mistakes are easy to recover.
130. As a user deleting a synchronized Google event, I want an explicit confirmation, so that an external commitment is not removed accidentally.
131. As a user deleting my account, I want a typed confirmation and prompt revocation of integration access, so that a destructive privacy action is deliberate.
132. As a user, I want to disconnect Google Calendar independently from account deletion, so that integration choices remain reversible.
133. As a user, I want to export app-owned data as JSON, so that I can take my Tasks, Thoughts, settings, and focus history elsewhere.
134. As a user, I want mirrored Google data excluded from the export, so that Rails does not present external data as app-owned.
135. As a user, I want Privacy, Terms, and Support pages, so that product expectations and contact paths are clear.
136. As a privacy-conscious user, I want analytics to exclude content and session replay, so that product measurement does not capture sensitive thoughts or tasks.
137. As a user, I want the MVP free and free of ads, billing, and artificial usage limits, so that access is not gated while the product is validated.
138. As a support operator, I want metadata-only audit records for sync, export, and deletion operations, so that failures can be diagnosed without reading user content.
139. As a support operator, I want audit records automatically purged after 90 days, so that operational visibility does not become indefinite tracking.
140. As a deleted user, I want retained operational records pseudonymized immediately, so that audit history cannot reconstruct my account.

## Implementation Decisions

### Product behavior and domain

- The product name is Rails. It is a Next.js product and must not be confused with the Ruby on Rails framework.
- The target audience is independent knowledge workers with ADHD. Rails is a productivity and self-organization tool, not a medical device or treatment.
- The MVP is English-only and restricted to adults, while architecture must remain ready for internationalized copy.
- Core domain concepts are Inbox Item, Task, Thought, Event, Area, Energy, Focus Session, Calendar Connection, Reminder Preference, and Sync Operation.
- A Task requires only a title. Optional fields include Scheduled for date, optional time, estimate, Energy, Important, Area, and notes.
- Energy values are Low, Medium, High, and unset. An unset Task is eligible for Any energy. Energy may reorder flexible Tasks but must never hide them or affect fixed commitments.
- Important is a Boolean rather than a priority scale.
- Each Task may have zero or one Area in the MVP. Area selection uses a shadcn Base Combobox with create-on-entry behavior. The model should leave room for multiple tags and richer filters after MVP.
- Thoughts are lightweight, searchable, non-actionable references. Projects and blocked-task relationships are deferred.
- One Focus Session may be active per account. Session state is server-persisted and includes elapsed timing, pause state, associated Task, and captured distraction count. Minimal completed-session history is retained for a future user dashboard.
- Estimates are informational. Reaching an estimate produces a calm reassessment cue, never an overdue or failure state.
- Deterministic recommendation rules consider upcoming commitments, Energy, estimate fit, Important status, and waiting time. Recommendations include a concise explanation. AI recommendations are deferred.
- Focus completion returns to Today by default. Viewing next items is secondary, and no Task starts automatically.
- App-owned deletions offer a 10-second Undo. Synchronized Google Event deletion requires explicit confirmation. Account deletion requires typed confirmation.
- App-owned deletion tombstones are retained for 30 days to prevent resurrection by another client, then purged automatically.

### Experience and information architecture

- Required destinations are Today, Inbox, Tasks, Calendar, Thoughts, Search, and Settings.
- Desktop uses a full collapsible sidebar. Mobile uses the shadcn Base Drawer as a full-screen navigation helper.
- Today contains Quick Capture, one Focus Now recommendation or selection, Energy Right Now, a timed timeline, and a collapsed lower-emphasis Available Tasks section.
- The command interface is Raycast-inspired and implemented with `dip/cmdk` inside shadcn-styled app components. Command or Control plus K opens it.
- Command actions use a command-menu prefix rather than global single-key shortcuts: C Capture, T New Task, E New Event, and N New Thought.
- Mobile exposes a visible command/search control that opens the same experience as a full-screen sheet.
- Creation uses dedicated full pages, not modal dialogs or drawers. Creation forms use debounced, device-local autosave that must not affect typing performance.
- Tasks provides Today, Upcoming, All/Anytime, and Completed views. Anytime includes every Task, not only unscheduled Tasks.
- Calendar is a weekly agenda. Mobile uses a vertical seven-day layout. Items after the current week appear in a separate Later list, grouped by month, with 20 initial items and cursor-based Load more.
- The Inbox unseen indicator is a numberless red badge with an accessible text equivalent. Items become seen when the Inbox is opened.
- Settings sections are Account, Calendars, Notifications, Appearance, Timezone, Data & Privacy, and About & Support.
- Appearance supports Light, Dark, and System through semantic CSS variables; System is the default.
- The UI must be complete and high quality on desktop and mobile. Capability-specific features use progressive enhancement rather than blocking unsupported browsers.

### Capture and parsing

- Quick Capture uses a conservative deterministic parser behind an adapter.
- `chrono-node` handles supported natural-language dates and times. A small custom duration parser handles expressions such as “about 15 minutes.”
- Parsed values are shown as editable chips before or during classification.
- A no-match result is explicit: “Saved to Inbox · No schedule detected,” with an Add details action.
- Timed captures are tentative until their type is confirmed. They may appear in the timeline and receive reminders, but are not written to Google Calendar until confirmed as Events.
- Type conversions among Task, Thought, and Event are explicit and preserve compatible fields while explaining external Calendar consequences.

### Google identity and Calendar integration

- Authentication uses Better Auth with its Drizzle adapter and Google as the only MVP identity provider.
- Basic Google identity authorization and incremental Google Calendar authorization are separate flows. Calendar access is strongly recommended but optional.
- Removing Calendar access must never remove or invalidate login.
- Google OAuth consent, branding, least-privilege scopes, privacy disclosures, verification, and token handling follow Google’s published requirements. OAuth verification is a launch dependency.
- Google Calendar is authoritative for connected Events. Rails keeps a local mirror for agenda rendering, search, and offline use.
- Synchronization is ongoing and bidirectional. Conflicts resolve in Google’s favor; retained local unsynchronized changes are shown for review rather than silently discarded.
- Users select visible calendars and one writable calendar. Shared calendars may be viewed; writes are permitted only to the selected writable calendar.
- Event storage mirrors Google-compatible start/end, timezone, all-day, recurrence identity, status, and provider identifiers. New timed Events default to 30 minutes.
- Imported all-day and recurring Events are displayed. Creating all-day Events and editing recurrence series are deferred; series edits route users to Google Calendar.
- Local Events are allowed without Calendar access. When access is later granted, export is an explicit user choice.
- Calendar watches and cursors are maintained per calendar. Stored metadata includes channel, resource, verification token, expiry, and synchronization token.
- Verified webhooks enqueue idempotent Inngest work rather than performing synchronization inline.
- Incremental synchronization is paginated. A uniqueness constraint on Google calendar ID plus event ID prevents duplication. Deleted provider Events are represented as mirror tombstones.
- Expired watches are renewed, and periodic reconciliation protects against missed webhooks.
- A Google `410 Gone` response clears only the affected calendar cursor and mirror, then performs a bounded full resynchronization.
- The default mirror window is 30 days in the past through 12 months in the future, with on-demand expansion and cleanup.
- Google refresh tokens are encrypted at the application layer using authenticated encryption and a versioned key held in Vercel encrypted environment configuration. Ciphertext, nonce, authentication tag, and key version are stored; plaintext tokens never reach the browser or logs.

### Reminders and notifications

- Google Calendar owns Event notifications to avoid duplicate alerts. Rails may show an optional in-app Event cue 15 minutes before the Event.
- Rails owns browser notifications for timed Tasks.
- Notification controls are capability-detected and hidden when unsupported. Denied or unsupported browsers retain in-app cues and all non-notification functionality.
- Permission is requested contextually after the user understands the benefit, not during initial page load.
- Notification settings include a master switch, timed-Task heads-up toggle, lead time of 5, 10, 15, or 30 minutes with 10 minutes default, at-time toggle, in-app Event cue toggle, and Test notification action.
- Web Push uses standard VAPID subscriptions and treats every browser/device subscription independently.
- Push payloads are minimal and content-safe.
- Serwist provides the service-worker integration; `web-push` handles Node-side Web Push delivery.

### Frontend and motion

- The application is a single-package Next.js App Router project using React and strict TypeScript.
- shadcn components use Base UI variants by default. Tailwind CSS and semantic CSS variables provide all theme foundations.
- React Hook Form and Zod 4 provide form state and shared validation.
- No Redux or Zustand store is introduced for MVP. Local React state and narrow contexts are sufficient for ephemeral interface state.
- Simple state transitions use Tailwind/CSS. The `motion` package is used selectively for interruptible springs, gestures, meaningful layout continuity, focus-state changes, task reordering, and drawer transitions.
- Base UI retains ownership of behavior, focus management, mounting semantics, and accessibility. Motion controls presentation through supported composition APIs.
- Motion must be responsive, interruptible, spatially consistent, and restrained. Pointer feedback is immediate. Transform and opacity are preferred for performance.
- Centralized motion tokens define a small set of timing and spring behaviors. Reduced motion removes or substitutes spatial movement, and reduced transparency/contrast preferences are respected where supported.
- Decorative page-load choreography, gratuitous stagger, scroll spectacle, and animation on every component are prohibited.
- After the first complete UI pass, the `improve-animations` skill performs a read-only audit. Approved plans are implemented separately and reviewed with the animation-specific skill set.
- WCAG 2.2 AA accessibility, contrast, keyboard behavior, screen-reader semantics, and performance are product pillars rather than post-launch polish.

### Offline behavior, client state, and synchronization

- Dexie/IndexedDB owns the durable local replica for offline-capable domain entities and the mutation outbox.
- A single local command layer atomically updates a Dexie entity and its outbox record. `useLiveQuery` exposes those optimistic changes to React immediately.
- TanStack Query owns cursor-paginated server views, remote job status, and server-confirmed request state. `useInfiniteQuery` manages Load more flows and bounded page retention.
- TanStack Query and Dexie must not independently own the same optimistic entity state. Avoid manual optimistic Query-cache choreography, persisted Query caches, TanStack DB, and duplicate client state machinery.
- After a synchronization acknowledgement, a centralized adapter reconciles Dexie and invalidates affected TanStack query keys.
- Optimistic behavior applies to reversible capture, completion, scheduling, reordering, and focus actions. Destructive Google Event and account operations wait for server confirmation.
- Syncable records use client-generated UUIDs stored in PostgreSQL `uuid` columns, so offline records never need temporary-ID remapping.
- Mutations carry idempotency keys, monotonic record versions, and a base version. Stale writes return `409 Conflict` and retain the local change for review. CRDTs and automatic field merging are out of scope.
- Capture, focus, and core domain actions work offline. Calendar data displays stale or pending state as appropriate. Queued writes retry safely after connectivity returns.

### Backend, APIs, data, and jobs

- PostgreSQL is provided by Neon through the Vercel Marketplace.
- Drizzle ORM and Drizzle Kit provide typed persistence and migrations.
- The codebase is organized by app routes, product features, a pure domain layer, server infrastructure, offline infrastructure, shadcn primitives, app-level components, shared schemas, and general library utilities.
- The domain layer contains no React, Next.js, Drizzle, or Google API dependencies.
- Feature-specific repositories own database access. Application services own use cases and transaction boundaries. Route handlers authenticate, validate, invoke a service, and translate results.
- Every repository operation requires an authenticated account scope. Foreign keys, ownership constraints, and integration tests enforce tenancy. PostgreSQL row-level security is deferred for MVP.
- Route Handler-first APIs live under a versioned `/api/v1` boundary. React Server Components may provide initial reads. Server Actions are limited to isolated, non-offline forms.
- Feature-owned Zod schemas define request and response contracts. A small typed API client is shared by UI, synchronization, and tests. A separate RPC framework and OpenAPI generation are deferred.
- API failures use a shared Problem Details-style envelope with a stable machine code, human-safe message, correlation ID, optional field errors, and retryability metadata. Stack traces, provider payloads, and secrets are never returned.
- Cursor pagination uses stable compound date-and-ID cursors rather than offsets.
- Native PostgreSQL full-text search plus `pg_trgm` provides partial and typo-tolerant server search. Dexie provides local offline search over synchronized content.
- Domain states such as Task status, Energy, and item type use constrained PostgreSQL `text` columns and strict TypeScript unions rather than PostgreSQL enums.
- Exact instants use PostgreSQL `timestamptz`; date-only Task schedules use `date`; durations use integer minutes; IANA timezone IDs preserve wall-clock intent.
- Temporal, with a polyfill where needed, performs date/time calculations. `Intl` performs display formatting. Interface language and formatting locale are separate.
- Inngest runs durable Calendar webhook processing, synchronization, watch renewal, reminders, exports, deletion workflows, reconciliation, and cleanup.
- Long-range schedules remain canonical in PostgreSQL; only near-term work is enqueued.
- A transactional outbox commits critical pending jobs in the same database transaction as their triggering mutation. Dispatch and job execution are idempotent.
- An append-only operational audit log records metadata for synchronization, export, and deletion operations: actor/account reference, action, opaque target, timestamps, outcome, correlation/job IDs, and safe error codes.
- Operational audit records never contain Task or Thought content, Calendar payloads, tokens, or exported data. They are retained for 90 days, purged automatically, and pseudonymized immediately when an account is deleted.

### Analytics, privacy, and security

- Umami Cloud in the US region provides content-free product analytics.
- Analytics events pass through a typed adapter and exclude user-authored content, Calendar details, full URLs containing sensitive values, tokens, and session replay.
- Initial success and retention targets may be recorded, but enforcement and optimization wait until real users exist.
- Users can disconnect Calendar, export app-owned data as JSON, and delete their account.
- Export excludes mirrored Google Calendar data because Google remains its owner and source.
- Security headers include nonce-based Content Security Policy, `frame-ancestors 'none'`, HSTS, `nosniff`, strict referrer policy, restrictive permissions policy, secure HTTP-only SameSite cookies, and explicit external allowlists.
- Vercel WAF, application-layer rate limits, Inngest throttling, and idempotency protect public and asynchronous surfaces. Redis is not introduced for MVP.
- Logs are structured, privacy-safe JSON with correlation IDs. Vercel Observability/OpenTelemetry and Inngest run history provide MVP diagnostics. Sentry is deferred.
- Rails ships Privacy, Terms, and Contact/Support pages. Legal claims must be reviewed before public launch; implementation must follow applicable privacy and security requirements without claiming unsupported certification.

### Deployment, environments, and operations

- The repository is hosted on GitHub and uses pnpm pinned through Corepack with a committed lockfile.
- Vercel hosts the application. Local, stable staging, and production are separate environments with separate OAuth clients, Neon databases, Inngest environments, VAPID keys, and secrets.
- Preview deployments never receive production OAuth or production data access.
- There are no required pull-request checks for MVP. Agents must run the complete local verification suite before sending a pull request.
- Release scripts provide `release:check`, `release:staging`, and `release:production`. Production release requires typed confirmation.
- Release scripts are fail-fast, never print secrets, create or verify a backup/restore point, and use expand-contract database migrations.
- Neon point-in-time recovery is retained for at least seven days. A snapshot is taken before production migrations. Restore drills occur before launch and after meaningful schema changes. The initial recovery-time objective is four hours.
- The MVP uses a single Next.js application in a single-package repository rather than a monorepo.
- Deterministic factories and a local/test-only database seed command create realistic sample data across timezones, sync states, and edge cases. Production seeding is disabled by construction.

### Performance budgets

- Core Web Vitals targets at the 75th percentile are LCP at or below 2.5 seconds, INP at or below 200 milliseconds, and CLS at or below 0.1.
- Local capture and focus acknowledgements target 100 milliseconds or less.
- Lighthouse CI is part of local verification. Bundle analysis is available through a dedicated command. Vercel Speed Insights and User Timing marks monitor production behavior.
- Motion and data access should prefer GPU-friendly properties, bounded query pages, narrow IndexedDB observation, lazy-loaded noncritical UI, and minimal client bundles.

## Testing Decisions

- Good tests assert externally observable behavior at the highest practical seam. They should not depend on component internals, Drizzle implementation details, animation frames, private functions, or snapshots of broad markup.
- Because this is a new repository, there is no existing test prior art. The initial suite establishes conventions that subsequent features must follow.
- The primary acceptance seam is Playwright against the running application and an ephemeral real PostgreSQL database. This covers the integrated user journeys with the fewest artificial boundaries.
- Playwright covers Chromium, Firefox, and WebKit in representative desktop and mobile viewports.
- Critical end-to-end journeys include onboarding with and without Calendar authorization; capture and parser no-match feedback; Inbox classification; Task creation and filtering; focus start/pause/resume/complete; distraction capture; Calendar fallback; Calendar synchronization state; offline capture and reconnect; reminder capability states; global search; theme selection; account export; Calendar disconnect; and account deletion.
- Playwright explicitly exercises offline mode, reconnect behavior, timezone boundaries, locale formatting, Light/Dark/System themes, notification permission states, narrow mobile layouts, keyboard-only operation, and reduced-motion behavior.
- Vitest tests the pure domain layer: recommendation ordering, Energy behavior, estimate messaging, scheduling semantics, focus state transitions, conversion rules, cursor encoding, version conflicts, tombstone policy, time calculations, and audit redaction.
- React Testing Library with `user-event` tests accessible component behavior and feature composition: forms, command menu, Drawer navigation, Combobox create-on-entry, parser chips, errors, status announcements, and confirmation/Undo flows.
- Repository and application-service integration tests use a real ephemeral PostgreSQL database. They verify ownership isolation, constraints, transactions, outbox atomicity, idempotency, cursor stability, text search, deletion tombstones, audit retention, and migration behavior.
- Google Calendar, OAuth boundary behavior, and Web Push are represented through explicit adapters and MSW at HTTP seams. Tests cover pagination, webhook verification, duplicated delivery, expired watches, `410 Gone`, deletion, retry, revoked scopes, provider conflicts, and safe error mapping.
- Dexie integration tests verify atomic entity-plus-outbox writes, `useLiveQuery` reactivity, pending states, retry reconciliation, cross-tab/worker updates where supported, and prevention of duplicate optimistic ownership with TanStack Query.
- TanStack Query tests focus on cursor-page accumulation, Load more state, bounded pages, invalidation after synchronization, and standard error presentation rather than Query internals.
- Inngest function tests verify idempotent execution, throttling, retry classification, durable scheduling, transactional-outbox dispatch, reconciliation, and cleanup jobs.
- Accessibility automation uses axe in component and Playwright coverage. Manual validation includes screen readers, zoom, keyboard traversal, focus restoration, contrast in both themes, reduced motion, and notification fallback.
- Performance verification includes Lighthouse CI budgets, bundle analysis, User Timing assertions for capture/focus acknowledgement, and representative long-list and Calendar data fixtures.
- Security tests verify authentication and authorization boundaries, CSRF/session behavior supplied by the auth layer, ownership leakage, webhook signatures/tokens, rate limits, security headers, safe API errors, log redaction, encrypted-token round trips, key-version migration, and absence of sensitive analytics fields.
- Release verification is exposed through one `pnpm verify` command that runs formatting checks, ESLint, TypeScript, unit tests, component tests, PostgreSQL integration tests, Playwright, Lighthouse where configured, and the production build.
- ESLint uses the flat configuration with Next.js Core Web Vitals and TypeScript rules plus the TanStack Query ESLint plugin. Prettier uses the Tailwind plugin. Broad snapshot tests and mandatory pre-commit hooks are not used.

## Out of Scope

- Ruby on Rails or any non-Next.js application framework.
- Native iOS, Android, or desktop applications.
- Users without a Google account and identity providers other than Google.
- Outlook, Apple Calendar, CalDAV, or other calendar providers.
- Locations, travel time, and leave-by calculations.
- Rails-owned Event recurrence creation or recurring-series editing.
- Creating all-day Events.
- Native recurring Tasks.
- Google Tasks synchronization.
- AI recommendations, automatic task breakdown, automatic scheduling, or automatic schedule changes.
- Projects, goals, blocked Tasks, dependencies, multi-Area Tasks, complex tags, and advanced filtering.
- Team collaboration, shared Rails workspaces, delegation, or body-doubling rooms.
- Gamification, streaks, points, scores, guilt, or punitive overdue states.
- Productivity, Energy, or focus analytics dashboards for users, beyond storing minimal internal Focus Session history.
- Pricing, billing, subscriptions, advertisements, and free-tier limits.
- Voice capture.
- Batch Inbox processing or Inbox Zero requirements.
- Per-Task custom reminder schedules beyond the global MVP preferences.
- Duplicate Rails browser notifications for Google Calendar Events.
- Sentry and full session replay.
- Redis, CRDTs, automatic field-level conflict merging, PostgreSQL row-level security, Elasticsearch, and separate search infrastructure.
- Redux, Zustand, TanStack DB, a persisted TanStack Query domain cache, a monorepo, a separate RPC framework, and OpenAPI generation.
- Mandatory GitHub pull-request checks, merge gates, and broad deployment automation beyond the assisted release scripts.
- Translated interface copy. The architecture remains i18n-ready.
- Unsupported claims of medical benefit, legal compliance, or security certification.

## Further Notes

- The implementation should preserve the calm-focus principle whenever a lower-level decision is not specified: one obvious action, suggestions without coercion, no hidden work, no guilt, and no accidental loss.
- Accessibility and performance are acceptance criteria for every feature, not a separate cleanup phase.
- Google Calendar authorization is optional in product behavior but OAuth verification and safe provider integration are launch-critical.
- The first implementation pass should establish the domain glossary and architectural decision records before feature work begins.
- The hybrid Motion approach was selected after confirming official compatibility among Motion, Base UI, Tailwind, and shadcn composition. Animation remains purposeful and restrained.
- The `improve-animations` skill is audit-only and should run after animation-bearing UI exists; it should not modify implementation during its audit.
- Future considerations intentionally recorded for after MVP include Projects, blocked Tasks, multiple Areas/tags, richer filtering, AI recommendations, additional calendar providers, location and leave-by support, user-facing Focus Session dashboards, pricing, Sentry, row-level security, and automated GitHub checks.
