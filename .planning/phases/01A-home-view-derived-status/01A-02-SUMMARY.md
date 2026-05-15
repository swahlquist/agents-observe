---
phase: 01A-home-view-derived-status
plan: 02
subsystem: web
tags: [react, vitest, web-audio, tanstack-query, radix-tabs, ui-store]

# Dependency graph
requires:
  - phase: 01A
    plan: 01
    provides: derivedStatus / statusDetail / needsYou / lastActionLabel / lastActionAt on /sessions/recent and /sessions/:id; wire-coerced lastActivity (never null)
provides:
  - useBell(needsYouCount) Web Audio single-tone bell hook gated by ui-store.bellEnabled
  - useTabTitle(needsYouCount, topSessionIntent) unconditional document.title writer with three-branch format and the U+00B7 middle dot separator
  - NeedsYouPile / ProjectGroup / SessionCard / FinishedToday presentational components
  - SessionView Overview / Activity tab strip with URL-persisted ?tab= state
  - ui-store.bellEnabled boolean persisted to localStorage under agents-observe-bell
  - WS handler invalidates ['recent-sessions'] on notification + notification_clear so the home view's needsYou count flips reactively
affects: [01A-future-bell-and-tab-title, 01B tasks layer, 01B legacy-status-field-removal]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Side-effect hooks gate transitions via useRef so behavior keys off render-to-render deltas (false-to-true flip detection without re-rendering)"
    - "Persistent zustand toggle mirrored from notificationsEnabled: localStorage key + setter that writes-through and updates the store"
    - "URL query state via replaceState (not pushState) so tab toggles do not pollute browser history but still survive reload"
    - "Single source of truth for derived-status fields on both Home and SessionView Overview: useRecentSessions hook; per-project /api/projects/:id/sessions intentionally NOT rewired in Phase 1a (H2 mitigation, deferred to 1b)"

key-files:
  created:
    - app/client/src/components/main-panel/session-card.tsx
    - app/client/src/components/main-panel/session-card.test.tsx
    - app/client/src/components/main-panel/needs-you-pile.tsx
    - app/client/src/components/main-panel/project-group.tsx
    - app/client/src/components/main-panel/finished-today.tsx
    - app/client/src/hooks/use-bell.ts
    - app/client/src/hooks/use-bell.test.ts
    - app/client/src/hooks/use-tab-title.ts
    - app/client/src/hooks/use-tab-title.test.ts
  modified:
    - app/client/src/types/index.ts
    - app/client/src/stores/ui-store.ts
    - app/client/src/hooks/use-websocket.ts
    - app/client/src/components/main-panel/home-page.tsx
    - app/client/src/components/main-panel/main-panel.tsx
    - app/client/src/components/main-panel/main-panel.test.tsx

key-decisions:
  - "Keep the legacy two-state status field on RecentSession alongside the new derivedStatus six-state union. 7+ in-repo consumers still read session.status === 'active'; rewriting them is deferred to Phase 1b. The new card render uses derivedStatus exclusively (verified by grep)."
  - "Trust Plan 01's wire-level coercion: RecentSession.lastActivity stays typed as `number` (not widened to `number | null`). The server substitutes started_at when last_activity is NULL, so client-side null guards at the three labels-modal / session-modal call sites are not needed."
  - "Single-client mode detection runs at home-page level (union of agentClasses across visible sessions). The boolean is threaded down through ProjectGroup / NeedsYouPile / FinishedToday into SessionCard, avoiding a duplicate scan per card."
  - "Bell + tab title hooks are invoked unconditionally on every HomePage render. The hooks themselves manage the false-to-true gate via useRef, so the parent does not need to memoize anything for the transition logic to work."
  - "WS invalidation lives next to pushNotification / clearNotification rather than inside the notification store. The cache is owned by TanStack Query; the notification store handles sidebar bells; both transports need to know."
  - "Local-midnight detection for the Finished Today bucket uses `new Date().setHours(0, 0, 0, 0)` (local tz via Intl.DateTimeFormat's underlying resolution) rather than UTC midnight, matching CONTEXT.md."

patterns-established:
  - "FNV-1a 32-bit hash for deterministic per-session color stripe index. Replaces the placeholder Math.random approach mentioned in early scoping notes; same hash will survive into Phase 1b when the index moves to a stored sessions.color column."
  - "Session-card status badge label composition (`buildStatusBadgeLabel`): appends tool name for WAITING_ON_PERMISSION and elapsed time for IDLE; exported alongside STATUS_BADGE so the SessionView Overview tab reuses the exact same palette and label rules."
  - "TabsContent unmounts inactive panels by default (Radix). Tests assert this via the absence of inactive testids; the URL query mechanism plus useState seed keeps the active tab in sync without imperatively forcing a remount."

requirements-completed: [HOME-03, HOME-04, HOME-05, HOME-06, HOME-07, HOME-08, HOME-09, HOME-10, HOME-13]

# Metrics
duration: 25min
completed: 2026-05-15
---

# Phase 01A Plan 02: Home View Derived Status (Client) Summary

**Rewrites the dashboard home view to consume Plan 01's five new derived fields. Ships four card components, two side-effect hooks (bell + tab title), an Overview/Activity tab strip on SessionView with URL-persisted state, and the WebSocket cache invalidation that makes notification arrivals flip `needsYou` reactively.**

## What Shipped

### Presentational components (Task 1)

- `SessionCard`: 3px FNV-1a-hashed color stripe (8-color LingoLinq-safe palette), category icon from `intent` keyword map (lucide-react: Wrench / Sparkles / BookOpen / Rocket / Brush / FlaskConical / Terminal), six-state status badge with `WAITING_ON_PERMISSION` tool-name append and `IDLE` elapsed-time append, `lastActionLabel`, relative time, and a client badge that hides in single-client mode. Click routes via `useUIStore` `setSelectedProject` + `setSelectedSessionId` (matching the existing `SessionList` flow). The status dot inside the badge pulses on activity via the existing `useSessionPulseActive` hook (no new infrastructure).
- `NeedsYouPile`: sorts entries by `lastActionAt` descending; empty state renders the verbatim row `"All clear. Nothing needs you."`.
- `ProjectGroup`: collapsible per-project header showing active count and finished-today count; expanded by default in Phase 1a (no persistence; deferred to 1b per CONTEXT.md).
- `FinishedToday`: collapsed by default, opens on click, renders nothing when zero. The `forceOpen` prop is computed by HomePage for the "only finished today" branch.

### `RecentSession` type extension

Added five new required fields to the existing interface and kept the legacy `status: string` field unchanged for backwards compatibility:

```ts
derivedStatus: 'WORKING' | 'WAITING_FOR_INPUT' | 'WAITING_ON_PERMISSION' | 'IDLE' | 'FINISHED' | 'ABANDONED'
statusDetail: string | null
needsYou: boolean
lastActionLabel: string | null
lastActionAt: number | null
```

Also exported a `SessionStatus` union for downstream consumers. `lastActivity` stays typed as `number` (not widened) per the Round 3 New-H mitigation: Plan 01 coerces it server-side.

### Side-effect hooks (Task 2)

- `useBell(needsYouCount)`: Web Audio sine tone, 800 Hz / 150 ms with 10 ms attack and 50 ms release. Retains a single `AudioContext` via `useRef` across renders so the first user gesture activates one context and reuses it (avoids Chrome's "AudioContext was not allowed to start" warning on every flip). Fires on false-to-true flip only; respects `bellEnabled` from `ui-store`; silently no-ops when `window.AudioContext` is unavailable.
- `useTabTitle(needsYouCount, topSessionIntent)`: writes `document.title` per the three-branch format from CONTEXT.md, using the U+00B7 middle dot (`·`) as separator. Restores `agents-observe` on unmount. Unconditional per CONTEXT.md (the bell has a mute toggle; the tab title does not).
- `ui-store` gains `bellEnabled: boolean` + `setBellEnabled` mirroring the `notificationsEnabled` pattern verbatim. Persisted to localStorage under `agents-observe-bell` ('on' / 'off'); defaults to on.

### HomePage rewrite + SessionView tabs (Task 3)

- `HomePage` drops `SessionList`, the "Recent Sessions" header, and the sort toggle. Renders, top to bottom: `OverlapBanner`, `NeedsYouPile` (or empty state), alphabetically-sorted `ProjectGroup` stack, `FinishedToday`, then `ExternalTasksPanel` (Notion Today) at the bottom per HOME-07.
- Empty-state branches: the no-sessions verbatim string, `"All quiet. Nothing active."`, and the auto-expanded Finished Today branch when zero are active.
- `useTabTitle` and `useBell` are invoked unconditionally; the hooks themselves manage refs internally.
- `MainPanel.SessionView`: existing four children (`ScopeBar`, `EventFilterBar`, `ActivityTimeline`, `EventStream`) wrap into `<TabsContent value="activity">`. A new `<TabsContent value="overview">` holds a placeholder card showing intent, `lastActionLabel`, the status badge (reusing the `STATUS_BADGE` map exported from `session-card.tsx`), and the literal note `"Tasks: arriving in Phase 1b"`. The Overview card reads from `useRecentSessions` (NOT `useSessions(projectId)`) per the H2 mitigation; sessions outside the 30-session window get the fallback string `"No recent activity. Open the Activity tab for full timeline."`.
- Tab state lives in `?tab=overview|activity`. `getInitialTab()` validates against the union and falls back to `'overview'`; `writeTabToUrl` uses `replaceState` so tab toggles do not pollute history.

### WebSocket cache invalidation

`use-websocket.ts` now invalidates `['recent-sessions']` inside the `notification` and `notification_clear` handler branches, mirroring the existing `session_update` invalidation. Total of 5 `recent-sessions` references in the file now (was 3). The pre-existing `pushNotification` / `clearNotification` calls remain.

## Test Coverage

- `session-card.test.tsx` (13 tests): IDLE non-NaN elapsed-time (New-H3 mitigation per plan), WAITING_ON_PERMISSION tool-name append, WAITING_FOR_INPUT label, hideClientBadge mode, slug fallback, button rendering, deterministic FNV-1a hash, keyword icon mapping, status badge label composition.
- `use-bell.test.ts` (6 tests): single oscillator on false-to-true flip, no oscillator when muted, no replay across holds, re-fire after drop-and-rise, 800 Hz frequency, no-throw when `window.AudioContext` is absent.
- `use-tab-title.test.ts` (6 tests): all three branches (N=0, N=1, N>1) including the U+00B7 middle dot, fallback to `"needs you"` when intent is null/empty, re-render reactivity, unmount cleanup, no em dash anywhere (`EM_DASH = String.fromCodePoint(0x2014)`).
- `main-panel.test.tsx` (7 tests, was 5): Overview default tab, Activity click switches and writes `?tab=activity`, `?tab=activity` in URL on mount, plus the existing routing transition tests.

**Suite total after Plan 02: 264 client tests pass (was 250). Server: 364 passing, 1 skipped. Hooks/scripts: 237 passing. `just check` exits 0.**

## Acceptance Criteria Verification

| Criterion | Status |
|---|---|
| Files exist: session-card.tsx, needs-you-pile.tsx, project-group.tsx, finished-today.tsx under app/client/src/components/main-panel/ | PASS |
| `RecentSession` carries the five new fields as required (non-optional), legacy `status` present, `lastActivity: number` unchanged | PASS (grep on `^\s*(status\|derivedStatus\|lastActivity):` returns all three; lastActivity line is `number`, not `number | null`) |
| `grep -n "WAITING_ON_PERMISSION" app/client/src/components/main-panel/session-card.tsx` returns at least one match | PASS (3 matches: STATUS_BADGE map, jsdoc, runtime check) |
| `grep -n "All clear. Nothing needs you." app/client/src/components/main-panel/needs-you-pile.tsx` returns one match | PASS |
| Files exist: use-bell.ts, use-bell.test.ts, use-tab-title.ts, use-tab-title.test.ts under app/client/src/hooks/ | PASS |
| `ui-store.ts` declares `bellEnabled: boolean` + setter and initializes from `localStorage.getItem('agents-observe-bell') !== 'off'` | PASS |
| `grep -n "agents-observe-bell" app/client/src/stores/ui-store.ts` returns exactly two matches | PASS (lines 480 and 482: one read, one write) |
| Bell tests cover 4 scenarios (single fire on flip, mute, no replay while held high, re-fire after drop and rise) | PASS |
| Tab title tests cover all three branches including the U+00B7 middle dot | PASS |
| `home-page.tsx` no longer imports `SessionList` and instead imports NeedsYouPile / ProjectGroup / FinishedToday | PASS |
| `home-page.tsx` invokes `useTabTitle` and `useBell` at top of HomePage | PASS (lines 115 and 116) |
| `main-panel.tsx` imports tabs primitives and wraps the timeline content in `<TabsContent value="activity">` | PASS |
| `main-panel.tsx` reads initial tab from `window.location.search` and writes via `window.history.replaceState` | PASS |
| Overview tab reads `useRecentSessions` (not `useSessions(projectId)`) | PASS (grep confirms only `useRecentSessions` is referenced in the Overview path) |
| `use-websocket.ts` invalidates `['recent-sessions']` in both `notification` and `notification_clear` branches | PASS (grep returns 5 matches; existing 3 plus 2 new, each inside the correct branch) |
| Three empty-state strings appear verbatim in home-page.tsx | PASS (no-sessions and all-quiet verified by grep; the third "All clear" string is in needs-you-pile.tsx per design) |
| `cd app/client && npm test` exits 0 | PASS (264 passing) |
| `just check` exits 0 | PASS |
| No em dashes (U+2014) or `--` runs in any new file content | PASS (diff-only grep returns clean for every modified/new file) |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Initial keyword-icon regex used `\b` word boundaries; failed on "document" / "auditing"**

- **Found during:** Task 1 verification, after running session-card tests.
- **Issue:** CONTEXT.md prescribed keywords are listed as bare stems (`doc`, `audit`, ...). My first pass used `/\b(doc|audit|...)\b/i`, which makes `doc` match only the exact word "doc", not "document". The test case `'document the api' -> 'BookOpen'` failed and reported the icon as `Terminal`.
- **Fix:** Replaced the regex with a substring-includes check that iterates the keyword tuple in priority order. Now "document", "auditing", "deploying", etc. all resolve correctly. Updated one test fixture (`'add unit test' -> FlaskConical`) that would have hit Sparkles ('add') before FlaskConical ('test') under the documented priority; changed to `'run unit test'`. Added an inline comment explaining the priority order.
- **Files modified:** `app/client/src/components/main-panel/session-card.tsx`, `app/client/src/components/main-panel/session-card.test.tsx`
- **Commit:** 2cf3cf4 (folded into the GREEN commit for Task 1)

**2. [Rule 3 - Blocking] `useTabTitle` test type-narrowed `intent` to `null` on `initialProps`, preventing rerender with a string**

- **Found during:** `just check` build step (tsc -b).
- **Issue:** `renderHook` infers `initialProps` literal types. `{ n: 1, intent: null }` typed `intent` as `null`, so subsequent `rerender({ n: 1, intent: '' })` failed compilation.
- **Fix:** Annotated `intent: null as string | null` on the two `initialProps` blocks. Test behavior unchanged.
- **Files modified:** `app/client/src/hooks/use-tab-title.test.ts`
- **Commit:** a958a7e (the Task 3 commit, which ran `just check` and caught the typecheck failure)

**3. [Rule 2 - Missing critical functionality] Reused `STATUS_BADGE` map by exporting from `session-card.tsx`**

- **Found during:** Task 3 implementation (Overview tab placeholder).
- **Issue:** The Overview tab needs the same six-state badge palette as the card. Plan 03 anticipates this and suggests "extract to a shared module if both files need it". Rather than duplicating the colors, I added `export` to the existing `STATUS_BADGE` const and `StatusBadgeDescriptor` interface in `session-card.tsx`. Documented as the natural reuse point until a third consumer arrives.
- **Files modified:** `app/client/src/components/main-panel/session-card.tsx`, `app/client/src/components/main-panel/main-panel.tsx`
- **Commit:** a958a7e

### Notes

- `main-panel.test.tsx` required additional mocks beyond the original three because the new `SessionView` consumes `useRecentSessions`, `useEffectiveEvents`, `useAgents`, `useRegionShortcuts`, the `EventProcessingProvider`, and the `SessionBreadcrumb`. All mocks are minimal: data hooks return a synthetic session matching the test fixture; providers return `<>{children}</>`. No behavior change from the original routing tests; the new tests are additive (Overview default, Activity click switch, URL respect on mount).
- Server dependencies in this worktree were not pre-installed; `npm install` ran inside `app/server` before `just check` could be exercised end-to-end. No source changes needed.
- One flake observed: `src/components/settings/project-modal.test.tsx > should open rename input` failed once in a parallel-test run but passed in isolation and on the subsequent full run. Not introduced by Plan 02 changes; flagged here for visibility but not addressed (out of scope per the plan's scope-boundary rule).

## Authentication Gates

None encountered. Pure client-side work; no external auth required.

## Known Stubs

- The Overview tab body is intentionally a thin placeholder per CONTEXT.md "SessionView tabs". Real content (linked tasks list, editable intent, category, color, project-goal progress, last-five-actions, needs-you dismiss button) is the explicit Phase 1b deliverable (TASK-10). The placeholder shows real derived data (intent / lastActionLabel / status badge) plus the verbatim note `"Tasks: arriving in Phase 1b"` so it is not silently empty.
- Sessions older than the 30-session `useRecentSessions` window cannot resolve in the Overview tab (the hook caps at 30). They get a fallback message directing the user to the Activity tab. Rewiring `/api/projects/:id/sessions` to carry the new derived fields is the documented H2 mitigation and is explicitly deferred to Phase 1b.

## Threat Flags

None. Plan 02 introduces no new network endpoints, auth paths, file access patterns, or schema changes. The five new fields rendered are short server-derived strings (`statusDetail` capped at 64 chars, `lastActionLabel` capped at 60 chars), all passed through React JSX which auto-escapes. The `?tab=` query parameter is validated against a literal union and falls back to `'overview'` on any other input (T-01A-02-02 mitigation per threat model). The bell mute toggle is a local-machine localStorage value with the same trust model as the existing `notificationsEnabled` toggle.

## Self-Check: PASSED

- `app/client/src/components/main-panel/session-card.tsx` exists: FOUND
- `app/client/src/components/main-panel/session-card.test.tsx` exists: FOUND
- `app/client/src/components/main-panel/needs-you-pile.tsx` exists: FOUND
- `app/client/src/components/main-panel/project-group.tsx` exists: FOUND
- `app/client/src/components/main-panel/finished-today.tsx` exists: FOUND
- `app/client/src/hooks/use-bell.ts` exists: FOUND
- `app/client/src/hooks/use-bell.test.ts` exists: FOUND
- `app/client/src/hooks/use-tab-title.ts` exists: FOUND
- `app/client/src/hooks/use-tab-title.test.ts` exists: FOUND
- `app/client/src/components/main-panel/home-page.tsx` rewritten: FOUND (grep shows NeedsYouPile / ProjectGroup / FinishedToday imports and useTabTitle + useBell invocations)
- `app/client/src/components/main-panel/main-panel.tsx` extended: FOUND (Tabs primitives + ?tab= URL state)
- `app/client/src/hooks/use-websocket.ts` adds invalidations: FOUND (2 new matches inside notification + notification_clear branches)
- `app/client/src/stores/ui-store.ts` adds bellEnabled: FOUND (one read, one write of `agents-observe-bell`)
- `app/client/src/types/index.ts` extends RecentSession: FOUND (five new fields plus legacy status)
- Commit 2cf3cf4 (Task 1 feat) exists: FOUND
- Commit d8c470b (Task 2 RED) exists: FOUND
- Commit d86f3a5 (Task 2 GREEN) exists: FOUND
- Commit a958a7e (Task 3 feat) exists: FOUND
- 264 client tests pass; 364 server tests pass (1 skipped); 237 hooks tests pass; `just check` exits 0
