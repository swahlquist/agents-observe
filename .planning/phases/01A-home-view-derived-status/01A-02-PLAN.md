---
phase: 01A-home-view-derived-status
plan: 02
type: execute
wave: 2
depends_on: [01]
files_modified:
  - app/client/src/components/main-panel/needs-you-pile.tsx
  - app/client/src/components/main-panel/project-group.tsx
  - app/client/src/components/main-panel/session-card.tsx
  - app/client/src/components/main-panel/finished-today.tsx
  - app/client/src/components/main-panel/home-page.tsx
  - app/client/src/components/main-panel/main-panel.tsx
  - app/client/src/hooks/use-bell.ts
  - app/client/src/hooks/use-bell.test.ts
  - app/client/src/hooks/use-tab-title.ts
  - app/client/src/hooks/use-tab-title.test.ts
  - app/client/src/hooks/use-websocket.ts
  - app/client/src/stores/ui-store.ts
  - app/client/src/types/index.ts
autonomous: true
requirements: [HOME-03, HOME-04, HOME-05, HOME-06, HOME-07, HOME-08, HOME-09, HOME-10, HOME-13, HOME-14, HOME-15]
must_haves:
  truths:
    - "Home view layout order: Overlap banner, Needs You pile, project groups, Finished today, Notion Today panel"
    - "Session cards render status badge, category icon, color stripe, intent, client badge, lastActionLabel, and relative time at 1280px and 1920px without overflow"
    - "On needsYou false-to-true flip, document.title updates within one render frame and the bell plays one short tone"
    - "Bell mute toggle persists across reloads in localStorage under key `agents-observe-bell`"
    - "SessionView has Overview (default) and Activity tabs; tab choice survives reload via `?tab=overview|activity` query parameter"
  artifacts:
    - path: "app/client/src/components/main-panel/needs-you-pile.tsx"
      provides: "Pile component for needsYou sessions sorted by lastActionAt desc"
      exports: ["NeedsYouPile"]
    - path: "app/client/src/components/main-panel/project-group.tsx"
      provides: "Collapsible per-project group with active and finished-today counts"
      exports: ["ProjectGroup"]
    - path: "app/client/src/components/main-panel/session-card.tsx"
      provides: "Single-session card with status badge, category icon, color stripe, client badge"
      exports: ["SessionCard"]
    - path: "app/client/src/components/main-panel/finished-today.tsx"
      provides: "Collapsed-by-default section listing sessions stopped after local midnight"
      exports: ["FinishedToday"]
    - path: "app/client/src/hooks/use-bell.ts"
      provides: "Web Audio sine-tone bell, fires once on needsYou count false-to-true flip"
      exports: ["useBell"]
    - path: "app/client/src/hooks/use-tab-title.ts"
      provides: "Document title hook with three-branch format using the middle dot separator"
      exports: ["useTabTitle"]
  key_links:
    - from: "app/client/src/components/main-panel/home-page.tsx"
      to: "app/client/src/components/main-panel/needs-you-pile.tsx"
      via: "direct import + render"
      pattern: "NeedsYouPile"
    - from: "app/client/src/components/main-panel/home-page.tsx"
      to: "app/client/src/hooks/use-tab-title.ts"
      via: "side-effect hook invocation"
      pattern: "useTabTitle\\("
    - from: "app/client/src/components/main-panel/home-page.tsx"
      to: "app/client/src/hooks/use-bell.ts"
      via: "side-effect hook invocation gated by ui-store bellEnabled"
      pattern: "useBell\\("
---

## Phase Goal

**As a** founder running 4 to 5 parallel agent sessions, **I want to** see at a glance which sessions need me, what each is doing right now, and which are finished, **so that** I can route my attention without reading event logs.

<objective>
Rewrite the dashboard home view to consume the five new server-side fields shipped by Plan 01. Replace the flat `SessionList` with a four-section layout (Overlap banner, Needs You pile, project groups, Finished today, Notion Today panel at bottom). Add side-effect hooks for the browser tab title and an audible bell. Add Overview / Activity tabs to SessionView, persisted via the URL `?tab=` query parameter.

Purpose: Deliver the glance-readable home view from CONTEXT.md § domain. Plan 01 supplies the wire data; this plan consumes it and ships the user-visible change.
Output: Four new presentational components, two new side-effect hooks, a new `bellEnabled` field on the UI store, an extended `RecentSession` type, a rewritten `HomePage`, and a tabbed `SessionView`.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/01A-home-view-derived-status/01A-CONTEXT.md
@.planning/REQUIREMENTS.md
@.planning/ROADMAP.md
@CLAUDE.md
@docs/DEVELOPMENT.md
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Build the four card components (NeedsYouPile, ProjectGroup, SessionCard, FinishedToday)</name>
  <files>
    - app/client/src/components/main-panel/session-card.tsx (new)
    - app/client/src/components/main-panel/needs-you-pile.tsx (new)
    - app/client/src/components/main-panel/project-group.tsx (new)
    - app/client/src/components/main-panel/finished-today.tsx (new)
    - app/client/src/types/index.ts (extend RecentSession only)
  </files>
  <read_first>
    - app/client/src/types/index.ts lines 85 to 125 (current `RecentSession` interface; five new optional fields are added here, not split into a new type)
    - app/client/src/components/main-panel/session-list.tsx lines 1 to 80 (existing card render: relative-time helper, click handler shape, project click flow; reuse the same `setSelectedProject` + `setSelectedSessionId` interaction)
    - app/client/src/hooks/use-pulse-active.ts (use `useSessionPulseActive` on the status dot; do not duplicate the timer infrastructure)
    - app/client/src/components/sidebar/notification-indicator.tsx (existing `NotificationIndicator` is the current sidebar-side bell affordance; do not import here; sessions cards have their own status badge per CONTEXT.md § "Card visuals")
    - .planning/phases/01A-home-view-derived-status/01A-CONTEXT.md § "Card visuals" (8-color stripe, icon keyword map, status badge palette, client badge with single-client-mode hide)
    - .planning/phases/01A-home-view-derived-status/01A-CONTEXT.md § "Sections and ordering" (Needs You sort order; project group header counts; Finished today collapsed default)
    - .planning/phases/01A-home-view-derived-status/01A-CONTEXT.md § "Empty states" (per-section empty-state strings; quote them verbatim)
    - app/client/src/agents/codex/index.tsx lines 1 to 10 (lucide-react import pattern already in use)
    - app/client/src/config/icon-catalog.ts (confirms Wrench / Sparkles / BookOpen / Rocket / Brush / FlaskConical / Terminal are all in the existing icon registry)
  </read_first>
  <behavior>
    - SessionCard renders for one session and shows, left to right: a 3-pixel vertical color stripe; a category icon (24x24); a primary intent line (title); a secondary line with status badge + lastActionLabel + relative time; a client badge ("claude" or "gemini") at the trailing edge. The whole card is keyboard-focusable and click-routable to SessionView, mirroring the existing `SessionList` row click handler.
    - Color stripe palette has exactly 8 colors per CONTEXT.md § "Card visuals". Index = `hash(session_id) % 8`. Use a deterministic 32-bit hash (e.g. FNV-1a or `cyrb53` style; do not use `Math.random()`).
    - Category icon: client-derived from intent text via the keyword map in CONTEXT.md § "Card visuals" (case-insensitive). Fallback is `Terminal`.
    - Status badge palette: WORKING green, WAITING_FOR_INPUT amber, WAITING_ON_PERMISSION red, IDLE muted gray, FINISHED blue, ABANDONED dim gray with slight transparency. Per CONTEXT.md § "Card visuals". For WAITING_ON_PERMISSION, append the tool name from `statusDetail` to the badge label (e.g. "Waiting on Bash"). For IDLE, append elapsed time (e.g. "Idle 15m") per HOME-13.
    - Client badge shows "claude" or "gemini" derived from `agentClasses[0]`. Hide the badge entirely when there is only one unique client class across all sessions in the home view (single-client mode per CONTEXT.md § "Card visuals"). The home page passes a `hideClientBadge` boolean prop down through ProjectGroup / NeedsYouPile / FinishedToday.
    - NeedsYouPile receives `sessions: RecentSession[]` where every entry has `needsYou === true`. Sort by `lastActionAt` descending (most recent first). If empty, render the collapsed one-line subtle row "All clear. Nothing needs you." per CONTEXT.md § "Empty states" and § "Sections and ordering".
    - ProjectGroup receives one project's `{ projectId, projectName, activeSessions, finishedTodaySessions }`. Header shows project name + active count + finished-today count. Expanded by default in Phase 1a (no persistence; explicitly deferred per CONTEXT.md § "Sections and ordering"). Caret toggles expand/collapse via local component state.
    - FinishedToday renders the count in a collapsed header and expands on click. Collapsed by default unless every session is finished and zero are active (per CONTEXT.md § "Empty states" item 3).
    - Define "finished today" client-side: `stoppedAt >= localMidnightToday`, where `localMidnightToday` is computed once per render via `new Date()` zeroed to local midnight using `Intl.DateTimeFormat` time-zone resolution (not UTC midnight).
    - All status badge labels, relative-time strings, and empty-state strings contain zero em dashes and zero double-hyphen runs. The middle dot character U+00B7 is not used in card content (it is reserved for the tab title hook in Task 2).
    - Extend `RecentSession` in `app/client/src/types/index.ts` with the five new optional fields: `status` (widened to the six-state union, replacing the legacy two-state string), `statusDetail: string | null`, `needsYou: boolean`, `lastActionLabel: string | null`, `lastActionAt: number | null`. Keep existing fields untouched.
  </behavior>
  <action>
    Create `session-card.tsx` first. Define a small `categoryIcon(intent)` helper inside the file (or in a sibling `session-card-helpers.ts` if it grows past 40 lines) that maps intent keywords to lucide-react icon components per CONTEXT.md § "Card visuals". Define a `colorStripeIndex(sessionId)` helper that returns 0..7 from a stable hash of the session id. Define a `STATUS_BADGE` map keyed by the six SessionStatus values, with `label` and `className` (Tailwind class for color). For WAITING_ON_PERMISSION, the label concatenates "Waiting on " + statusDetail when present. For IDLE, append elapsed time computed from `lastActivity`. Reuse the existing `formatRelativeTime` helper from `session-list.tsx` (copy or extract to a shared module; extract if both `session-list` and `session-card` need it; otherwise inline a fresh copy here, since CONTEXT.md § "Things to leave alone" calls out that `session-list.tsx` still backs ProjectView until Phase 1b and should not be deleted).

    Implement the click handler the same way `SessionList`'s row currently does, via `useUIStore` `setSelectedProject` + `setSelectedSessionId`. The card is a `<button>` (not a `<div>`) so the keyboard-focus path comes for free.

    Use `useSessionPulseActive(sessionId)` to animate a small dot inside the status badge on activity, per CONTEXT.md § "Reusable assets" (`useSessionPulseActive` keeps working in the new card).

    Create `needs-you-pile.tsx`. Accepts `sessions: RecentSession[]` and `hideClientBadge: boolean`. Sort `[...sessions].sort((a, b) => (b.lastActionAt ?? 0) - (a.lastActionAt ?? 0))`. Empty branch returns a 1-line subtle row containing the exact string "All clear. Nothing needs you." from CONTEXT.md § "Empty states".

    Create `project-group.tsx`. Accepts `{ projectId, projectName, projectSlug, activeSessions, finishedTodaySessions, hideClientBadge }`. Header is a button toggling local `expanded` state, defaulting to `true`. Counts are computed from the array lengths. Collapsed: header only. Expanded: header + a flat list of `SessionCard` for active sessions.

    Create `finished-today.tsx`. Accepts `{ sessions, hideClientBadge, forceOpen }` where `forceOpen` is computed by the parent (the "all sessions finished today, none active" case). Local state defaults to `forceOpen`. Collapsed shows just the count header. Expanded shows the list.

    Edit `app/client/src/types/index.ts`. Locate the `RecentSession` interface (lines 98 to 125 in current main). Replace the existing `status: string` with `status: 'WORKING' | 'WAITING_FOR_INPUT' | 'WAITING_ON_PERMISSION' | 'IDLE' | 'FINISHED' | 'ABANDONED'`. Add `statusDetail: string | null`, `needsYou: boolean`, `lastActionLabel: string | null`, `lastActionAt: number | null` as required (non-optional) fields. Plan 01 guarantees every wire response carries them. Do not split into a new type; CONTEXT.md § "Reusable assets" requires the same hook to continue serving the payload.

    No em dashes (U+2014) or double-hyphen ("--") runs anywhere in card content, badge labels, empty-state strings, or comments that will ship to users (per CLAUDE.md hard rule).
  </action>
  <acceptance_criteria>
    - Files exist: `session-card.tsx`, `needs-you-pile.tsx`, `project-group.tsx`, `finished-today.tsx` under `app/client/src/components/main-panel/`.
    - `RecentSession` in `app/client/src/types/index.ts` carries the five new fields with the six-state status union (required, not optional).
    - Test command: `cd app/client && npm test` exits 0 (no new tests required for Task 1 itself, but existing tests must continue to pass after the type widening).
    - Source assertion: `grep -n "WAITING_ON_PERMISSION" app/client/src/components/main-panel/session-card.tsx` returns at least one match (the status badge map).
    - Source assertion: `grep -n "All clear. Nothing needs you." app/client/src/components/main-panel/needs-you-pile.tsx` returns one match (verbatim empty-state string).
    - No em dashes (U+2014) and no double-hyphen ("--") runs in any new file content.
  </acceptance_criteria>
  <verify>
    <automated>cd app/client &amp;&amp; npm test &amp;&amp; cd ../.. &amp;&amp; just fmt</automated>
  </verify>
  <done>Four presentational components are in place, the type is widened, and the existing test suite still passes. Components are not yet wired into `home-page.tsx` (Task 3 does the wiring).</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Side-effect hooks (use-bell, use-tab-title) and ui-store bellEnabled</name>
  <files>
    - app/client/src/hooks/use-bell.ts (new)
    - app/client/src/hooks/use-bell.test.ts (new)
    - app/client/src/hooks/use-tab-title.ts (new)
    - app/client/src/hooks/use-tab-title.test.ts (new)
    - app/client/src/stores/ui-store.ts (extend interface + initial state + setter)
  </files>
  <read_first>
    - app/client/src/stores/ui-store.ts lines 100 to 200 (the `notificationsEnabled` field at lines 152 to 153; this is the pattern to mirror exactly)
    - app/client/src/stores/ui-store.ts lines 440 to 490 (the `notificationsEnabled` setter implementation at lines 466 to 470; clone the localStorage shape)
    - .planning/phases/01A-home-view-derived-status/01A-CONTEXT.md § "`needsYou` flip side effects (client)" (three-branch tab title format, Web Audio bell spec, single-fire false-to-true semantics)
    - hooks/scripts/lib/config.mjs (env var policy; confirm no client-side env read is introduced)
  </read_first>
  <behavior>
    - `useBell(needsYouCount)` plays one short sine-tone via Web Audio API on every false-to-true flip of `needsYouCount > 0`. Tone is 800 Hz, 150 ms, peak gain attack 10 ms, release 50 ms (to avoid the click of an abrupt cutoff). No replay while count stays > 0; only re-fires after count drops to 0 and rises again. Reads `bellEnabled` from `useUIStore`; if false, the hook is a no-op.
    - `useBell` does nothing when AudioContext is unavailable (server-side render, or `typeof window === 'undefined'`). It does not throw.
    - `useTabTitle(needsYouCount, topSessionIntent)` writes `document.title` per the three-branch format from CONTEXT.md § "`needsYou` flip side effects (client)":
      - count === 0: title is `agents-observe`
      - count === 1: title is `(1) <topSessionIntent or "needs you"> · agents-observe`
      - count > 1: title is `(<count>) sessions need you · agents-observe`
      The U+00B7 middle dot character (`·`) is intentional; no em dash.
    - `useTabTitle` is unconditional per CONTEXT.md § carry_forward (the bell has a mute toggle; the tab title does not).
    - The bell tests stub `window.AudioContext` and assert: (a) one oscillator is created and started on the first false-to-true flip; (b) no oscillator is created when `bellEnabled` is false; (c) no oscillator is created when count stays > 0 across renders; (d) a second oscillator is created when the count drops to 0 then rises again.
    - The tab title tests assert each of the three branches sets `document.title` correctly, including the middle dot character. The N=1 branch falls back to the literal string `"needs you"` when the top session intent is null or empty. No em dashes anywhere.
    - `ui-store.ts` gains `bellEnabled: boolean` and `setBellEnabled(enabled: boolean): void`. The initial value reads from `localStorage.getItem('agents-observe-bell') !== 'off'` (default true). The setter writes localStorage and calls `set({ bellEnabled: enabled })`. Mirror the `notificationsEnabled` block exactly; do not introduce a new shape.
  </behavior>
  <action>
    Write `use-bell.test.ts` first. Use Vitest with the jsdom environment already configured for the client. Mock `window.AudioContext` with a small spy harness that records the count of `createOscillator()` calls. Assert the four behaviors listed above. The hook reads `bellEnabled` from `useUIStore`; in tests, manipulate `useUIStore.setState({ bellEnabled: true })` before rendering and `false` for the "muted" case.

    Write `use-tab-title.test.ts` next. Use `renderHook` from `@testing-library/react` (already a test dep; confirm via `app/client/package.json`). Assert all three title branches set `document.title` correctly.

    Implement `use-bell.ts`. Use `useRef` to retain the AudioContext across renders (allocating one per render is wasteful and triggers Chrome's "AudioContext was not allowed to start" gesture warnings; a single instance survives gesture activation). Use `useRef` to track the previous `needsYouCount > 0` boolean. On a render where previous was `false` and current is `true`, create an oscillator, set frequency 800 Hz, schedule attack/release on a `GainNode`, start, then stop 150 ms later. Bail out early when `!bellEnabled` or `typeof window === 'undefined'`.

    Implement `use-tab-title.ts`. Use `useEffect` keyed on `[needsYouCount, topSessionIntent]`. Compose the title per the three-branch format. Set `document.title` directly. On unmount, reset to `"agents-observe"`.

    Edit `app/client/src/stores/ui-store.ts`. Add the `bellEnabled: boolean` and `setBellEnabled` declaration to the `UIStore` interface adjacent to `notificationsEnabled` (around lines 152 to 153). In the store factory body adjacent to lines 466 to 470 (the existing `notificationsEnabled` initialization and setter), add the mirror block: `bellEnabled: localStorage.getItem('agents-observe-bell') !== 'off',` and `setBellEnabled: (enabled) => { localStorage.setItem('agents-observe-bell', enabled ? 'on' : 'off'); set({ bellEnabled: enabled }) }`.

    Do not introduce a `process.env` read anywhere in these files (CLAUDE.md hard rule: env reads belong only in `hooks/scripts/lib/config.mjs`; on the client side, similar discipline applies; no new `import.meta.env` accesses are needed for this work).

    No em dashes in any string literal: especially the tab title formatter, the bell hook (no user-facing strings there), and the test assertion messages. The U+00B7 middle dot is required exactly twice in the tab title format and is not an em dash.
  </action>
  <acceptance_criteria>
    - Files exist: `use-bell.ts`, `use-bell.test.ts`, `use-tab-title.ts`, `use-tab-title.test.ts` under `app/client/src/hooks/`.
    - `ui-store.ts` declares `bellEnabled: boolean` and `setBellEnabled: (enabled: boolean) => void` and initializes `bellEnabled` from `localStorage.getItem('agents-observe-bell') !== 'off'`.
    - Test command: `cd app/client && npm test` exits 0; new tests are part of the run.
    - Behavioral assertion: the bell tests cover the four scenarios listed (single fire on flip, no fire when muted, no replay while held high, re-fire after drop and rise).
    - Behavioral assertion: the tab title tests cover all three branches and verify the middle dot U+00B7 character appears in the N=1 and N>1 branches.
    - Source assertion: `grep -n "agents-observe-bell" app/client/src/stores/ui-store.ts` returns exactly two matches (one read, one write).
    - No em dashes (U+2014) and no double-hyphen ("--") runs in any new file content.
  </acceptance_criteria>
  <verify>
    <automated>cd app/client &amp;&amp; npm test</automated>
  </verify>
  <done>The two side-effect hooks are implemented and unit-tested, and the UI store exposes a persistent `bellEnabled` toggle that mirrors `notificationsEnabled`. The hooks are not yet invoked from `home-page.tsx` (Task 3 does the wiring).</done>
</task>

<task type="auto" tdd="false">
  <name>Task 3: Rewrite HomePage and add Overview/Activity tabs to SessionView</name>
  <files>
    - app/client/src/components/main-panel/home-page.tsx (rewrite)
    - app/client/src/components/main-panel/main-panel.tsx (extend `SessionView` with tabs and URL query state)
    - app/client/src/hooks/use-websocket.ts (wire `notification` and `notification_clear` WS messages into the `['recent-sessions']` cache so `needsYouCount` flips reactively)
  </files>
  <read_first>
    - app/client/src/components/main-panel/home-page.tsx (current implementation; being replaced)
    - app/client/src/components/main-panel/main-panel.tsx (current `SessionView` at lines 40 to 59; the existing body becomes the Activity tab content)
    - app/client/src/hooks/use-recent-sessions.ts (single payload hook; do NOT split into a second hook; extend the response type via Task 1 instead)
    - app/client/src/hooks/use-websocket.ts lines 147 to 204 (current message handler. The `session_update` branch at line 147 invalidates `['recent-sessions']` (line 153); the `notification` branch at line 174 and `notification_clear` branch at line 180 do NOT. Task 3 adds the missing invalidations so the home page's `needsYouCount` flips reactively when a real permission notification arrives. Without this, the bell and tab-title side effects never fire on the path they were designed for.)
    - app/server/src/routes/events.ts lines 268 to 282 (server emits `type: 'notification'` when `pendingTransition === 'set'` and `type: 'notification_clear'` when `pendingTransition === 'cleared'`. These are the WS messages whose handlers Task 3 modifies. Transitions only fire on actual false-to-true or true-to-false changes, so invalidation frequency stays bounded.)
    - app/client/src/components/main-panel/overlap-banner.tsx (kept verbatim above the Needs You pile per CONTEXT.md § "Sections and ordering")
    - app/client/src/components/main-panel/external-tasks-panel.tsx (moves to the bottom of the home page per HOME-07)
    - .planning/phases/01A-home-view-derived-status/01A-CONTEXT.md § "Sections and ordering" (layout order, project group sort, Finished today, Notion Today, Overlap banner)
    - .planning/phases/01A-home-view-derived-status/01A-CONTEXT.md § "Empty states" (three empty-state branches)
    - .planning/phases/01A-home-view-derived-status/01A-CONTEXT.md § "SessionView tabs" (Overview default, Activity body unchanged, URL query `?tab=overview|activity`)
    - app/client/src/components/ui/tabs.tsx (existing shadcn-style tabs primitive)
    - app/client/src/components/main-panel/scope-bar.tsx (existing SessionView header chrome; keep unchanged above the tabs)
  </read_first>
  <behavior>
    - `HomePage` renders, top to bottom, exactly this order: `OverlapBanner` (unchanged); then a region containing `NeedsYouPile`; then a stack of `ProjectGroup` components, one per project, sorted alphabetically by project name; then `FinishedToday`; then `ExternalTasksPanel` (the Notion "Today" panel) at the bottom.
    - Empty states per CONTEXT.md § "Empty states":
      - When the recent sessions array is empty: render the single string `"No sessions yet. Run a Claude Code or Gemini CLI command to see it here."` in place of the four sections.
      - When `needsYou` is empty and active sessions are empty (only finished sessions exist): render `"All quiet. Nothing active."` in place of the Needs You + project group regions, but still render `FinishedToday`.
      - When every session is finished today and zero are active: pass `forceOpen={true}` into `FinishedToday` so it renders expanded.
    - The home page computes the single-client-mode boolean: `hideClientBadge = new Set(sessions.flatMap(s => s.agentClasses)).size <= 1`. Passes this down to each section component.
    - The home page invokes `useTabTitle(needsYouCount, topSessionIntent)` unconditionally on every render. `needsYouCount` = count of sessions with `needsYou === true`. `topSessionIntent` = the intent of the highest-sorted needsYou session (the one rendered first in the pile), or `null` if none.
    - The home page invokes `useBell(needsYouCount)` (the hook itself short-circuits on `bellEnabled === false`).
    - The WebSocket message handler in `use-websocket.ts` invalidates the `['recent-sessions']` query on both `type: 'notification'` and `type: 'notification_clear'` server broadcasts. Without this, the server flips `pending_notification_ts` and broadcasts the notification, but the home page's TanStack Query cache for `['recent-sessions']` does not refetch, so `needsYou` stays false in the rendered data and `useBell` and `useTabTitle` never observe the flip. This is the wire-level fix that makes HOME-08 and HOME-09 fire on a real notification arrival. The existing `pushNotification` and `clearNotification` calls in those branches stay; the new behavior is purely additive (one extra invalidation line per branch, mirroring the existing `session_update` pattern at line 153).
    - Group sessions by `projectId`. Sessions with `projectId === null` are placed under a synthetic "Unassigned" group with `projectName: "Unassigned"`. Inside a group, separate active from finished-today by status: status === FINISHED with stoppedAt after local midnight goes to that group's `finishedTodaySessions`; everything else with status !== FINISHED goes to `activeSessions`. (Finished sessions older than local midnight go to a global "older" bucket that is dropped from the home view; the 30-session window already trims them.)
    - SessionView (in `main-panel.tsx`) gets a tab strip above the existing content. Two tabs: "Overview" (default) and "Activity". The Activity tab body is the current `SessionView` content unchanged (`ScopeBar`, `EventFilterBar`, `ActivityTimeline`, `EventStream`). The Overview tab body is a thin placeholder per CONTEXT.md § "SessionView tabs": a card listing `intent` (read-only display in 1a), `lastActionLabel`, status badge, and the verbatim note `"Tasks: arriving in Phase 1b"`.
    - Tab state is held in the URL query string under `?tab=overview` or `?tab=activity`. On mount, the component reads `new URLSearchParams(window.location.search).get('tab')` and defaults to `'overview'` if missing or unrecognized. On tab change, the component writes the new value via `window.history.replaceState` (no full navigation; preserve the existing hash-based session routing).
    - The `SessionBreadcrumb` stays above the tab strip; the breadcrumb is shared chrome, not part of either tab's body.
  </behavior>
  <action>
    Edit `app/client/src/hooks/use-websocket.ts`. In `handleMessage` (the `useCallback` starting around line 110), locate the `else if (msg.type === 'notification')` branch (around line 174) and add `queryClient.invalidateQueries({ queryKey: ['recent-sessions'] })` as the first line of the branch body, before the existing `pushNotification(...)` call. Do the same in the `else if (msg.type === 'notification_clear')` branch (around line 180), invalidating the same query before the existing `clearNotification(...)` call. These additions mirror the existing `session_update` handler's invalidation pattern (line 153). No new tests required (the existing WS handler has no unit-test coverage today; the integration is covered by the manual smoke step in the verification block below). If a trace log line is desired for parity with the surrounding branches, follow the existing `if (logLevel === 'trace') console.debug(...)` shape; otherwise omit.

    Rewrite `app/client/src/components/main-panel/home-page.tsx`. Drop the `Recent Sessions` heading, the sort toggle, and the `SessionList` body. Keep `useRecentSessions(30)` as the only data hook (Plan 01 ships the new fields on the same query). Compute the four section inputs (`needsYouSessions`, `projectGroups`, `finishedTodaySessions`, the empty-state branch) with `useMemo` keyed on the query data.

    Use `useTabTitle(needsYouCount, topSessionIntent)` and `useBell(needsYouCount)` at the top of the component body. Both must run on every render so the false-to-true flip detection works correctly (the hooks themselves manage refs internally).

    Reorder the JSX so `OverlapBanner` comes first, then the Needs You pile + project groups + Finished today, then `ExternalTasksPanel` at the bottom (HOME-07).

    For SessionView in `main-panel.tsx`: import `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` from `@/components/ui/tabs`. Wrap the existing four children (`ScopeBar`, `EventFilterBar`, `ActivityTimeline`, `EventStream`) into a `<TabsContent value="activity">...</TabsContent>` block. Add a sibling `<TabsContent value="overview">` block with the placeholder card. The `Tabs` root binds its `value` to a local state, initialized from the URL query parameter (reading `new URLSearchParams(window.location.search).get('tab')`, defaulting to `"overview"`). On change, update the local state and call `window.history.replaceState({}, '', newUrl)` where `newUrl` is the same path with the `?tab=` query rewritten.

    Add a small helper `getInitialTab()` inside `main-panel.tsx` (or a sibling file `session-tab-state.ts` if it grows past 20 lines) that returns `'overview' | 'activity'` from the URL query, defaulting to `'overview'`.

    The Overview tab placeholder card is a small `<div>` containing: intent (or "(no intent set)" if null), `lastActionLabel` (or "no recent action"), the status badge (reuse the `STATUS_BADGE` map from `session-card.tsx`; extract to a shared helper file `session-status-badge.tsx` if both files now need it), and the literal string "Tasks: arriving in Phase 1b". The card fetches the session via `useSessions(projectId)` (already in use by SessionView today) and reads the matching row.

    No em dashes anywhere in user-facing strings, including the empty-state strings, the placeholder card body, and the tab labels. The middle dot U+00B7 appears only in the tab title format (Task 2), not in the home page or tabs.
  </action>
  <acceptance_criteria>
    - `app/client/src/components/main-panel/home-page.tsx` no longer imports `SessionList` and instead imports `NeedsYouPile`, `ProjectGroup`, `FinishedToday` (verifiable with `grep -n "import" app/client/src/components/main-panel/home-page.tsx`).
    - `app/client/src/components/main-panel/home-page.tsx` invokes `useTabTitle` and `useBell` at the top of `HomePage`.
    - `app/client/src/components/main-panel/main-panel.tsx` imports tabs primitives from `@/components/ui/tabs` and the `SessionView` body wraps the timeline content in a `<TabsContent value="activity">`.
    - `app/client/src/components/main-panel/main-panel.tsx` reads the initial tab from `window.location.search` and writes back via `window.history.replaceState`.
    - `app/client/src/hooks/use-websocket.ts` invalidates `['recent-sessions']` inside both the `notification` and `notification_clear` branches of `handleMessage`. Verify via `grep -n "recent-sessions" app/client/src/hooks/use-websocket.ts`: expect at least three matches (existing `session_update` invalidation at line 153, plus two new invalidations in the `notification` and `notification_clear` branches). Confirm via `grep -nB1 "invalidateQueries.*recent-sessions" app/client/src/hooks/use-websocket.ts` that each invalidation sits inside the correct `msg.type === ...` branch, not at the top of the handler.
    - The three empty-state strings appear verbatim in the source: `grep -n "No sessions yet. Run a Claude Code or Gemini CLI command to see it here." app/client/src/components/main-panel/home-page.tsx` returns one match; same for `"All quiet. Nothing active."`.
    - Test command: `cd app/client && npm test` exits 0. The existing `main-panel.test.tsx` is updated to assert the Overview tab renders by default and switching to Activity renders the timeline body. If the existing test cannot be adapted in this plan, add a follow-up smoke test in `main-panel.test.tsx` that exercises the tab toggle.
    - Repo-level: `just check` exits 0.
    - No em dashes (U+2014) or double-hyphen ("--") runs in any new or modified user-facing string.
  </acceptance_criteria>
  <verify>
    <automated>just check</automated>
  </verify>
  <done>HomePage renders the new four-section layout. Tab title and bell side effects fire on `needsYou` flips. SessionView has Overview and Activity tabs with deep-linkable `?tab=` state. `just check` is green.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries
| Boundary | Description |
|---|---|
| Server payload to React render | The five new fields land via the existing TanStack Query payload; React JSX auto-escapes everything that goes through `{value}`. |
| URL query string to component state | `?tab=` is read on mount; only `'overview'` and `'activity'` are accepted, anything else falls back to default. |
| LocalStorage to UI store | `agents-observe-bell` boolean is the only new persisted key; same shape as the existing `agents-observe-notifications`. |
| Web Audio API access | First bell click may require an AudioContext gesture; failure is silently swallowed. |

## STRIDE Threat Register
| Threat ID | Category | Component | Disposition | Mitigation Plan |
|---|---|---|---|---|
| T-01A-02-01 | I | `statusDetail` and `lastActionLabel` rendered inside session card | mitigate | Plan 01 caps both at 60 to 64 characters. React JSX auto-escapes via `{value}`; no `dangerouslySetInnerHTML` is added anywhere in the new components. |
| T-01A-02-02 | T | URL query parameter `?tab=` could carry an unexpected value | mitigate | `getInitialTab()` validates against the literal union `{ 'overview', 'activity' }` and falls back to `'overview'` on any other input. |
| T-01A-02-03 | I | `document.title` could leak a long intent value into another open browser tab's history | accept | Intent is user-authored and already visible inside the dashboard; per CONTEXT.md § "`needsYou` flip side effects (client)" the title is unconditional. Solo-founder single-user mode; no third-party leakage path. |
| T-01A-02-04 | D | Web Audio bell could be triggered by a runaway flip loop | mitigate | The hook uses a previous-state ref to gate firing strictly on false-to-true transitions; cannot re-fire while held high. Test case covers this. |
| T-01A-02-05 | S | Forged localStorage value for `agents-observe-bell` | accept | Same trust model as the existing `agents-observe-notifications` key; local-machine tampering is out of scope for a single-user dashboard. |
</threat_model>

<verification>
- `cd app/client && npm test` exits 0 (covers Task 1 type changes, Task 2 hook tests, Task 3 tab smoke test).
- `cd app/server && npm test` exits 0 (must remain green; Plan 01 work should not regress).
- `just check` from repo root exits 0 (runs all tests + Prettier).
- Manual smoke (HOME-14 glance test): open `http://localhost:4981`, confirm the four-section layout renders in the correct order, the Notion Today panel appears at the bottom, and an active session is identifiable in under 2 seconds without clicking.
- Manual smoke (HOME-08 + HOME-09): trigger a `Notification` event from a real Claude Code session; the browser tab title updates within 1 second to `(1) <intent> · agents-observe` and the bell plays once. Toggle the bell off via the new UI store path; trigger another notification; confirm the title still updates but no bell plays. Open Chrome DevTools Network tab and confirm a `GET /api/sessions/recent` refetch fires within ~200 ms of the WS `notification` frame arriving (visible in the WS tab as `{"type":"notification",...}`). The refetch is the cache-invalidation signal landing; if it is missing, the `useBell` + `useTabTitle` flips will not fire and HOME-08/HOME-09 are silently broken regardless of unit-test results.
- Manual smoke (HOME-10): navigate to a session, confirm the URL gains `?tab=overview` (or stays at that value if absent). Switch to Activity, reload the page; confirm the URL still says `?tab=activity` and the timeline renders.
- Manual parity check (HOME-15): run `~/ai-company-brain/scripts/today-summary.sh` and compare its active-and-awaiting list against the home view side by side. They should agree.
</verification>

<success_criteria>
1. Home view renders the four sections in the prescribed order: Overlap banner, Needs You pile, alphabetically-sorted project groups, Finished today, Notion Today panel at bottom. (HOME-03, HOME-04, HOME-06, HOME-07)
2. Each session card shows status badge, category icon, color stripe, intent, client badge (when not single-client mode), `lastActionLabel`, and relative time without overflow at 1280px and 1920px. (HOME-05, HOME-13)
3. On a `needsYou` false-to-true flip the browser tab title updates and the bell plays once when unmuted; the bell respects the `bellEnabled` toggle and the toggle survives reload. (HOME-08, HOME-09)
4. SessionView has Overview (default) and Activity tabs; the URL query parameter `?tab=` survives reload and deep-links correctly. (HOME-10)
5. A founder can identify the status of every active session in under 2 seconds at a glance. (HOME-14, manual)
6. `/today` and the home view agree on which sessions are active and which need attention. (HOME-15, manual)
7. `just check` passes.
</success_criteria>

<output>
After completion, create `.planning/phases/01A-home-view-derived-status/01A-02-SUMMARY.md` covering: component file list, hook contract surfaces, ui-store extension, tab-title and bell tested branches, and any unexpected deviations from CONTEXT.md (expected: none).
</output>
