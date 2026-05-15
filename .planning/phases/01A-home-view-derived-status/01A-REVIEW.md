---
phase: 01A-home-view-derived-status
reviewed: 2026-05-15T00:00:00Z
depth: standard
files_reviewed: 23
files_reviewed_list:
  - app/server/src/lib/derive-status.ts
  - app/server/src/lib/derive-status.test.ts
  - app/server/src/routes/sessions.ts
  - app/server/src/routes/sessions.test.ts
  - app/server/src/routes/projects.ts
  - app/server/src/routes/projects.test.ts
  - app/server/src/storage/sqlite-adapter.ts
  - app/server/src/storage/types.ts
  - app/client/src/components/main-panel/finished-today.tsx
  - app/client/src/components/main-panel/home-page.tsx
  - app/client/src/components/main-panel/main-panel.tsx
  - app/client/src/components/main-panel/main-panel.test.tsx
  - app/client/src/components/main-panel/needs-you-pile.tsx
  - app/client/src/components/main-panel/project-group.tsx
  - app/client/src/components/main-panel/session-card.tsx
  - app/client/src/components/main-panel/session-card.test.tsx
  - app/client/src/hooks/use-bell.ts
  - app/client/src/hooks/use-bell.test.ts
  - app/client/src/hooks/use-tab-title.ts
  - app/client/src/hooks/use-tab-title.test.ts
  - app/client/src/hooks/use-websocket.ts
  - app/client/src/stores/ui-store.ts
  - app/client/src/types/index.ts
findings:
  critical: 3
  warning: 7
  info: 5
  total: 15
status: issues_found
---

# Phase 01A: Code Review Report

**Reviewed:** 2026-05-15
**Depth:** standard
**Files Reviewed:** 23
**Status:** issues_found

## Summary

The phase delivers the documented behavior: server emits five derived
fields, client groups by project plus needs-you pile, hooks fire side
effects on flip. Status derivation is well-factored and well-tested.
Test coverage is solid for happy paths.

The defects concentrate at three boundaries the PLAN didn't tighten:

1. **HomePage mount/unmount lifecycle.** Both `useTabTitle` and
   `useBell` treat dependency-change cleanups as if they were unmount
   cleanups. The result is observable: tab title flickers on every
   render where `needsYouCount` or `topSessionIntent` changes, the
   tab indicator disappears the moment the user navigates into a
   project (even when sessions still need them), and the bell
   re-fires after a project-view round trip because the
   "previous-state" ref resets to `false` on remount. The
   `MainPanel` `isResolvingRoute` guard makes this worse on every
   page load: HomePage mounts, unmounts a tick later, then mounts
   again, costing one cleanup write plus one fresh AudioContext per load.

2. **Wire-shape consistency.** `/sessions/unassigned` returns
   `derivedStatus: 'WORKING'` for every non-stopped session via the
   `placeholderDerived` shortcut, regardless of actual state. The
   comment claims the sidebar reads legacy `status` only, but the
   wire field is still a public contract; a second consumer
   reading `derivedStatus` from this endpoint silently gets wrong
   data. Same problem for `/sessions/recent?limit>50`.

3. **State-initializer staleness.** `FinishedToday` derives initial
   `expanded` state from the `forceOpen` prop via `useState(forceOpen)`,
   which only fires on first mount. When the home view transitions
   from "have active sessions" to "only finished today" (sessions
   complete during a viewing session, a real workflow), the section
   stays collapsed instead of expanding as CONTEXT.md "Empty states"
   branch 3 requires.

Server-side derivation logic is correct; the test suite captures the
five status states with real journal strings as required. The
`coerceWireLastActivity` helper is genuinely useful and lands at both
endpoints. The `parseNotificationMessage` regex chain matches the
documented order and falls back cleanly.

## Critical Issues

### CR-01: `useTabTitle` cleanup wipes the indicator on every re-render and on HomePage unmount

**File:** `app/client/src/hooks/use-tab-title.ts:21-35`

**Issue:** The `useEffect` cleanup function unconditionally writes
`document.title = BASE_TITLE`. React invokes the cleanup not only on
unmount but **between every effect run** when dependencies change.
So a transition from `needsYouCount=2` to `needsYouCount=3` produces
three writes: prior cleanup writes `agents-observe`, the new effect
writes `(3) sessions need you · agents-observe`. A flash to the
plain title is observable on every change, defeating the point of the
indicator (CONTEXT.md acceptance criterion 3: "the browser tab title
updates within 1 second").

Worse: when HomePage unmounts (user clicks any project in the
sidebar) the cleanup fires unconditionally. The tab title drops the
"(N) needs you" indicator even though sessions still need attention.
The user is now actively looking at a session view while other
sessions silently wait, with no visible indicator. This is the exact
condition the indicator exists to prevent.

The `MainPanel` `isResolvingRoute` guard at `main-panel.tsx:28-31`
compounds this: on every hash-load with a project slug, HomePage
mounts, then unmounts a tick later when the route resolves, then
mounts again. Each cycle wipes and rewrites the title.

**Fix:**
```ts
export function useTabTitle(needsYouCount: number, topSessionIntent: string | null): void {
  useEffect(() => {
    let nextTitle: string
    if (needsYouCount <= 0) {
      nextTitle = BASE_TITLE
    } else if (needsYouCount === 1) {
      const label = topSessionIntent && topSessionIntent.length > 0 ? topSessionIntent : 'needs you'
      nextTitle = `(1) ${label} ${MIDDLE_DOT} ${BASE_TITLE}`
    } else {
      nextTitle = `(${needsYouCount}) sessions need you ${MIDDLE_DOT} ${BASE_TITLE}`
    }
    document.title = nextTitle
    // No cleanup: the next effect run will write the correct title; on
    // unmount we want the indicator to persist (the user is still
    // logged in and sessions still need them). If a global title reset
    // on app unmount is required, do it from the app root, not here.
  }, [needsYouCount, topSessionIntent])
}
```

The corresponding test (`use-tab-title.test.ts:64-69`) that asserts
"resets to the base title on unmount" should be updated to reflect
the new spec: the indicator should persist across HomePage
unmount/remount cycles. Either move the title-write to the app root
(so it survives navigation), or accept that unmount preserves the
last-written value.

---

### CR-02: `useBell` re-fires on every HomePage remount when `needsYouCount > 0`

**File:** `app/client/src/hooks/use-bell.ts:21-73`

**Issue:** `prevHasNeedsRef` is initialized to `false` on every mount.
When HomePage unmounts (user navigates to a project) and remounts
(user navigates back) with `needsYouCount` already > 0, the effect
treats this as a fresh false-to-true flip and rings the bell.

Real-world scenario: user has 2 sessions needing attention, clicks
into one to handle it, finishes it (count drops to 1, still > 0),
clicks Home and the bell rings again even though nothing new happened.
With the `isResolvingRoute` re-mount pattern in `main-panel.tsx`,
the bell can ring on a routine page reload while sessions are
pending.

CONTEXT.md "needsYou flip side effects (client)" is explicit:
"The bell plays once per flip (false to true). It does not replay on
every notification while needsYou stays true." A remount mid-pending
is functionally the same as "while needsYou stays true," but the
current implementation does replay.

**Fix:** Persist the previous-state across remounts. The simplest
correct approach is to use a Zustand selector backed by the existing
`ui-store`, mirroring the `bellEnabled` pattern. Alternatively, key
the bell off WS `notification` events (which the WS layer already
emits) rather than off `needsYouCount` deltas, so the trigger is the
actual state transition rather than a derived count change.
Sketch using a module-scoped variable as the minimum-touch
mitigation:

```ts
// Module-scope so unmount/remount of HomePage doesn't reset.
let prevHasNeeds = false

export function useBell(needsYouCount: number): void {
  const bellEnabled = useUIStore((s) => s.bellEnabled)
  const audioContextRef = useRef<AudioContext | null>(null)
  useEffect(() => {
    const hasNeeds = needsYouCount > 0
    const wasFalse = !prevHasNeeds
    prevHasNeeds = hasNeeds
    if (!hasNeeds || !wasFalse) return
    if (!bellEnabled) return
    // ...rest unchanged
  }, [needsYouCount, bellEnabled])
}
```

(A cleaner version would route this through `ui-store` for
testability. The existing module-level pattern is hostile to
Vitest module resets, which is why the test file already has to
do `vi.resetModules()` in some suites.)

---

### CR-03: `FinishedToday` `expanded` state is stale when `forceOpen` flips after mount

**File:** `app/client/src/components/main-panel/finished-today.tsx:27`

**Issue:** `const [expanded, setExpanded] = useState(forceOpen)`. The
argument to `useState` is consumed only on the initial render. If
`forceOpen` changes later (because the home view transitions from
"active sessions exist" to "all sessions finished today," a real
workflow when the user finishes their last running session),
`expanded` stays at its initial value of `false`. The section stays
collapsed despite CONTEXT.md "Empty states" branch 3 specifying:
"All sessions finished today (none open) -> Finished today shows
expanded by default."

`HomePage` computes `onlyFinishedToday` per-render and passes it as
`forceOpen`. The intent is clearly "expand the section when this
becomes true," but the implementation only honors `forceOpen` at
mount.

**Fix:**
```tsx
const [expanded, setExpanded] = useState(forceOpen)
// Sync to forceOpen changes. The user can still collapse manually
// after the auto-expand; local state takes over once they click.
const lastForceOpenRef = useRef(forceOpen)
useEffect(() => {
  if (forceOpen !== lastForceOpenRef.current) {
    lastForceOpenRef.current = forceOpen
    if (forceOpen) setExpanded(true)
  }
}, [forceOpen])
```

Or, since CONTEXT.md doesn't promise the toggle survives further
state changes, simpler:

```tsx
const [userToggled, setUserToggled] = useState(false)
const expanded = userToggled ? !forceOpen : forceOpen
const onClick = () => setUserToggled((t) => !t)
```

Add a test that flips `forceOpen` from `false` to `true` across
re-renders and asserts the section ends up expanded.

## Warnings

### WR-01: `placeholderDerived` returns `derivedStatus: 'WORKING'` for sessions that may be IDLE / ABANDONED / WAITING

**File:** `app/server/src/routes/sessions.ts:34-42, 109-111, 134`

**Issue:** When `/sessions/recent?limit>50` or `/sessions/unassigned`
short-circuits derivation, the route stamps every active session as
`derivedStatus: 'WORKING'`. This is wire-visible. The route comment
defends the shortcut on the grounds that sidebar/settings consumers
read the legacy `status` field, but the new `derivedStatus` field is
now part of the public wire contract and could be consumed by any
future caller, including a refactored sidebar.

Even today, the `useRecentSessions` hook (used both by HomePage at
`limit=30` and by `MainPanel:66` at `limit=30`) feeds an
identically-shaped `RecentSession` type. Any caller that does
`/sessions/unassigned` and feeds the result into a UI that reads
`derivedStatus` (e.g. an "unassigned sessions" list inside HomePage)
will silently see "Working" badges on idle and abandoned sessions.

This is also subtly inconsistent with CONTEXT.md "Status derivation
rules" which makes no exception for placeholder rows.

**Fix:** Either (a) drop the new derived fields entirely from
placeholder responses (mark them optional in `RecentSession`), or
(b) compute status from `stoppedAt` plus `last_activity` without the
event lookup (cheaper than full derivation, still correct for
WORKING / IDLE / ABANDONED; only loses the WAITING_* distinction,
which the placeholder branch is already implicitly accepting).

```ts
function placeholderDerived(row: any, now: number): DerivedStatusFields {
  if (row.stopped_at) {
    return { derivedStatus: 'FINISHED', statusDetail: null, needsYou: false, lastActionLabel: null, lastActionAt: null }
  }
  const ref = row.last_activity ?? row.started_at ?? now
  const age = now - ref
  let s: SessionStatus = 'WORKING'
  if (age >= 30 * 60_000) s = 'ABANDONED'
  else if (age >= 60_000) s = 'IDLE'
  return { derivedStatus: s, statusDetail: null, needsYou: false, lastActionLabel: null, lastActionAt: null }
}
```

This is O(1) per row, costs no extra queries, and matches the full
derivation's output for all non-Notification states.

---

### WR-02: `audioContextRef` is never closed; one new `AudioContext` per HomePage mount cycle

**File:** `app/client/src/hooks/use-bell.ts:31, 49-51`

**Issue:** The hook holds an `AudioContext` in a ref but provides no
cleanup. On every HomePage unmount (e.g. navigate to a project), the
ref is dropped along with the component. The browser-owned
`AudioContext` lingers until GC, but a new one is allocated on
remount. Chrome enforces a hard cap of 6 concurrent AudioContexts
per tab; aggressive navigation can hit it.

Combined with CR-01/CR-02's remount pattern (every page load and
every `isResolvingRoute` round trip remounts HomePage), this isn't
hypothetical: a few minutes of normal navigation can exhaust the
budget. After that point, `new Ctor()` throws and the catch
swallows it silently, so the bell stops working with no signal.

**Fix:**
```ts
useEffect(() => {
  return () => {
    audioContextRef.current?.close().catch(() => {})
    audioContextRef.current = null
  }
}, [])
```

Or move the AudioContext to a module-scope singleton (matches the
CR-02 fix shape).

---

### WR-03: `pickLastAction` order-detection heuristic misclassifies events with identical timestamps

**File:** `app/server/src/lib/derive-status.ts:216-236`

**Issue:** The function tries to autodetect ASC vs DESC ordering with
`if (lastTs >= firstTs) ordered.reverse()`. When every event in the
batch shares one timestamp (a burst of events recorded at the same
ms, or a single fan-out from one tool call), the check returns
`true`, the array is reversed, and the "newest" element is whichever
one happened to be inserted last in the DB order, not necessarily
the most recent. For DESC input (the default from
`getRecentEventsForSession`), this means flipping a correctly-
ordered array.

In practice the storage path is DESC (`getRecentEventsForSession`
uses `ORDER BY timestamp DESC`), so the heuristic only matters for
test fixtures and for `getEventsForSession` callers. But the derive
function is publicly exported; nothing prevents a future caller from
passing an unsorted array.

**Fix:** Drop the autodetect. Make the function require DESC ordering
(documented and matched by `getRecentEventsForSession`), or sort
defensively:

```ts
const ordered = events
  .slice()
  .sort((a, b) => (b.timestamp ?? -Infinity) - (a.timestamp ?? -Infinity))
const window = ordered.slice(0, 5)
```

`events.length` is bounded at 50, so the sort is free.

---

### WR-04: `findMostRecentNotification` and `pickLastAction` use different "newest" semantics

**File:** `app/server/src/lib/derive-status.ts:243-255, 216-236`

**Issue:** `findMostRecentNotification` does a linear scan tracking
`bestTs`, correct regardless of array order. `pickLastAction` does
the autodetect-and-maybe-reverse dance. The two return values can
disagree about "which event is newest." Concretely: with a mixed-
order array, `findMostRecentNotification` will find the true newest
Notification, but `pickLastAction` might pick an older event as
`lastAction`. The `lastActionLabel` and the `statusDetail` then
reference different points in time.

**Fix:** Unify on the same approach (sort once, scan both). Already
covered by the WR-03 fix.

---

### WR-05: `parseInt` without radix and without NaN guard

**File:** `app/server/src/routes/sessions.ts:104, 130, 210, 215, 216`

**Issue:** `parseInt(c.req.query('limit')!)` accepts strings like
`'10abc'` (parses to 10) and `'abc'` (parses to NaN). When NaN
reaches `getRecentSessions(NaN)`, SQLite binds NaN which
`better-sqlite3` will either reject as TypeError or coerce
unpredictably. The threshold check `limit > DERIVED_LIMIT_THRESHOLD`
is `false` for NaN, so a malformed `?limit=abc` request falls into
the full-derivation branch with a NaN limit. Better-sqlite3 throws
on NaN binding; the error surfaces as a 500 with a stack trace.

This pattern predates Phase 1a but is now exercised by the new
derivation path. The same applies to `since`, `offset` on
`/sessions/:id/events`.

**Fix:**
```ts
const raw = c.req.query('limit')
const parsed = raw ? Number.parseInt(raw, 10) : 20
const limit = Number.isFinite(parsed) && parsed > 0 ? parsed : 20
```

---

### WR-06: `setSelectedSessionId` via `setTimeout(..., 0)` after `setSelectedProject` is a fragile microtask trick

**File:** `app/client/src/components/main-panel/session-card.tsx:189-193`

**Issue:**
```tsx
setSelectedProject(session.projectId, session.projectSlug ?? null)
setTimeout(() => setSelectedSessionId(session.id), 0)
```

The comment says "match the SessionList pattern: route through a
microtask so the project-id setter has flushed before the session-id
arrives." This relies on the fact that `setSelectedProject` calls
`set({ ..., selectedSessionId: null, ... })` (ui-store.ts:300-313),
which would clobber a same-tick `setSelectedSessionId` call.

The fix is correct in spirit but fragile: any future change to the
store's set ordering (e.g. batching, async middleware) breaks it
silently. A `setSelectedProject` that already accepted a session id
would be far safer:

```ts
setSelectedProject(id, slug, sessionId?: string | null)
```

Or expose a `selectSession(projectId, slug, sessionId)` action that
runs both updates in one `set()`. Filed as a warning because the
current code works in practice but is one tiny refactor away from a
regression.

---

### WR-07: `eventToLabel` docstring contradicts behavior

**File:** `app/server/src/lib/derive-status.ts:153-206`

**Issue:** Docstring says "Returns null if the event payload cannot
be parsed (defensive against malformed JSON in storage)." The actual
behavior is to catch the JSON parse error, set `payload = {}`, and
**continue** to the switch statement returning a label based on
`hook_name`. The function only returns `null` when `event.timestamp`
is null.

This isn't a bug per se but the docstring will mislead the next
maintainer. Either update the docstring or change the behavior to
match.

**Fix:** Update the docstring:
```ts
/**
 * Build the label + timestamp from a single event row. Returns null
 * only when the event has no timestamp; malformed JSON payloads fall
 * back to a hook-name-only label.
 */
```

## Info

### IN-01: Dead expression `projectId == null && null`

**File:** `app/client/src/components/main-panel/main-panel.tsx:106-107`

**Issue:** `{projectId == null && null}` always evaluates to `null`
(when `projectId == null`) or `false` (when it isn't). React renders
neither, so this is a no-op. The comment claims it's keeping the
prop on the API; the prop is already destructured at line 59. The
`&& null` evaluation does nothing for the prop, it's just dead JSX.

**Fix:** Delete the line:
```tsx
return (
  <EventProcessingProvider ...>
    {/* ... */}
  </EventProcessingProvider>
)
```

The `projectId` prop is still part of the function signature, which
satisfies whatever external API contract the comment refers to.

---

### IN-02: `OverviewTabBody` `session` type uses a brittle conditional inference

**File:** `app/client/src/components/main-panel/main-panel.tsx:113-117`

**Issue:**
```tsx
interface OverviewTabBodyProps {
  session: ReturnType<typeof useRecentSessions>['data'] extends Array<infer T> | undefined
    ? T | null
    : null
}
```

This obfuscates what is really just `RecentSession | null`. If the
return type of `useRecentSessions` ever stops being `Array<X> |
undefined` (e.g. switches to `{data, error}` shape), this type
silently collapses to `null` and every prop access starts failing.

**Fix:**
```tsx
import type { RecentSession } from '@/types'
interface OverviewTabBodyProps {
  session: RecentSession | null
}
```

---

### IN-03: Inconsistent `?? 0` fallback for `lastActionAt` produces undefined sort order

**File:** `app/client/src/components/main-panel/needs-you-pile.tsx:23`, `app/client/src/components/main-panel/home-page.tsx:49`

**Issue:** `(b.lastActionAt ?? 0) - (a.lastActionAt ?? 0)` sorts null
timestamps to the end (treated as oldest). But CONTEXT.md
"Sections and ordering" says the Needs You pile sorts by "most-
recent `pending_notification_ts` first". The server-side
`pending_notification_ts` IS the trigger, and `lastActionAt` is a
proxy that's not always populated (e.g. when the H6 fallback fires,
`lastActionAt` is null). With the current sort, a session that hit
the H6 fallback (canonical pending flag, no Notification in window)
sorts to the bottom of "Needs You," exactly backwards from intent.

`HomePage` does the same sort at line 49 with the same flaw.

**Fix:** Either expose `pending_notification_ts` to the client (cheap
addition to the wire shape) or fall back to `lastActivity` (which
the new wire-coerce step makes non-null):
```ts
(b.lastActionAt ?? b.lastActivity) - (a.lastActionAt ?? a.lastActivity)
```

---

### IN-04: `sessions.ts:r: any` and `rowToRecentSession(r: any, ...)` lose type safety at the boundary

**File:** `app/server/src/routes/sessions.ts:72, 110, 115`

**Issue:** All the row mappers accept `r: any`. The five new derived
fields are stamped after the legacy fields, so a typo in
`derived.derivedStatus` vs `derivedStatus: derived.derivedStatus`
won't fail at compile time. This is a maintenance trap given that
the wire contract was just expanded by 5 fields.

**Fix:** Define a row type that mirrors the `getRecentSessions`
return shape (already mostly known) and a wire type that mirrors
`RecentSession` from the client `types/index.ts`. Use them to type
the mapper input/output. The route-level `any` is a long-running
pattern in this repo so this is filed as info; PR-time fix is
optional but the next maintainer will thank you.

---

### IN-05: Color-stripe FNV hash + mod 8 has no regression lock

**File:** `app/client/src/components/main-panel/session-card.test.tsx:121-128`

**Issue:** The test claims "Pre-computed once; if FNV hashing changes,
this will fail loudly" but doesn't actually assert any pre-computed
expected value. The shift-based FNV-1a in `session-card.ts:40-48`
uses `(hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8)
+ (hash << 24))) >>> 0` to multiply by the FNV prime via shifts. The
math is correct (`1 + 2 + 16 + 128 + 256 + 16777216 = 16777619 =
0x01000193`), but comment-bearing shift-multiply implementations get
edited by future authors and break silently.

**Fix:** Lock the constant:

```ts
// Regression guard against future shift-multiply refactors.
expect(colorStripeIndex('sess-known-a')).toBe(/* pre-computed integer 0..7 */)
expect(colorStripeIndex('00000000-0000-0000-0000-000000000000')).toBe(/* pre-computed */)
```

Pick two or three fixed inputs, compute outputs once, and freeze
them in the test.

---

_Reviewed: 2026-05-15_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
