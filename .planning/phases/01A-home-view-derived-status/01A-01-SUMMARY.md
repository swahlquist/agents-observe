---
phase: 01A-home-view-derived-status
plan: 01
subsystem: api
tags: [hono, sqlite, vitest, status-derivation, observability]

# Dependency graph
requires:
  - phase: pre-01A
    provides: pending_notification_ts column, startSessionNotification / clearSessionNotification storage helpers, idx_events_session_ts compound index, existing /sessions/recent and /sessions/:id route handlers, legacy deriveSessionStatus + rowToRecentSession helpers
provides:
  - deriveStatus(session, events, now) pure function that returns DerivedStatusFields {derivedStatus, statusDetail, needsYou, lastActionLabel, lastActionAt}
  - coerceWireLastActivity(row) helper consumed by both sessions.ts and projects.ts
  - EventStore.getRecentEventsForSession(sessionId, limit) newest-first events lookup (DESC, indexed)
  - Wire contract for the five new derived fields on /sessions/recent and /sessions/:id
  - Wire-coerced lastActivity (never null) across /sessions/recent, /sessions/:id, and /projects/:id/sessions
affects: [01A-02 client redesign, 01A-future-bell-and-tab-title, 01B tasks layer, 01B legacy-status-field-removal]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure derivation helpers in app/server/src/lib/ (no I/O, time injected) for status/string transforms tested independently of the SQLite layer"
    - "Wire-level coercion helper (coerceWireLastActivity) shared across route handlers so the same null-handling rule runs in every place the column is surfaced"
    - "Sibling storage methods for ASC vs DESC ordering (getEventsForSession vs getRecentEventsForSession) so different consumers do not compete over a single ordering"
    - "Limit-gated derivation: per-row fan-out enabled only when request limit <= DERIVED_LIMIT_THRESHOLD (50); high-limit callers get placeholder derived fields"

key-files:
  created:
    - app/server/src/lib/derive-status.ts
    - app/server/src/lib/derive-status.test.ts
    - app/server/src/routes/projects.test.ts
  modified:
    - app/server/src/routes/sessions.ts
    - app/server/src/routes/projects.ts
    - app/server/src/storage/types.ts
    - app/server/src/storage/sqlite-adapter.ts
    - app/server/src/routes/sessions.test.ts

key-decisions:
  - "Keep legacy two-state status field on the wire alongside the new derivedStatus. 7+ in-repo consumers still read session.status === 'active'; rewriting them is out of Phase 1a scope. The legacy deriveSessionStatus(stoppedAt) helper at routes/sessions.ts:16 is unchanged."
  - "Add getRecentEventsForSession as a NEW sibling method instead of mutating getEventsForSession. The existing ASC-ordered method has another caller (sessions.ts:211) that depends on ASC + pagination semantics."
  - "Skip per-row derivation when limit > DERIVED_LIMIT_THRESHOLD (50). Bounds total per-request event lookups at min(rowCount, 50). Home view's useRecentSessions(30) gets full derivation; settings / projects-tab's useRecentSessions(10000) returns placeholders (derivedStatus = stoppedAt ? FINISHED : WORKING; other fields null/false)."
  - "Wire-coerce lastActivity to (last_activity ?? started_at) on every endpoint that surfaces session rows so the existing client type RecentSession.lastActivity: number stays honest. Applied at /sessions/recent (full + placeholder branches), /sessions/:id, /sessions/unassigned, and /projects/:id/sessions."
  - "Treat the pending_notification_ts column as canonical. When the flag is set but the fetched 50-event window contains no Notification event, default to WAITING_FOR_INPUT with null statusDetail instead of falling through to the recency cascade (H6 mitigation)."
  - "NULL last_activity substitutes started_at in the recency cascade. Without this, `now - null` coerces to `now` and pushes fresh / just-cleared sessions straight into ABANDONED (H3 mitigation)."

patterns-established:
  - "Pure-function status derivation: deriveStatus(session, events, now) takes time as a parameter and does zero I/O. Future Phase 1b derivation expansions can extend the helper without touching the route handlers."
  - "Limit-gated fan-out: DERIVED_LIMIT_THRESHOLD = 50 gates per-row event lookups in /sessions/recent. The same gate pattern can be reused for any future per-row derivation that costs a SQL roundtrip."
  - "Append-only response shape: new HOME-01 fields land after the existing fields in rowToRecentSession; legacy field order is preserved so consumers iterating keys see the same prefix."

requirements-completed: [HOME-01, HOME-02, HOME-11, HOME-12, HOME-14, HOME-15]

# Metrics
duration: 15min
completed: 2026-05-15
---

# Phase 01A Plan 01: Home View Derived Status (Server) Summary

**Server now derives five new fields per session (`derivedStatus`, `statusDetail`, `needsYou`, `lastActionLabel`, `lastActionAt`) at query time, using real captured journal Notification message strings, with a 1+N(<=50) query budget and a high-limit-caller skip gate.**

## What Shipped

- New module `app/server/src/lib/derive-status.ts` exporting:
  - `SessionStatus` union of six string literals (`WORKING`, `WAITING_FOR_INPUT`, `WAITING_ON_PERMISSION`, `IDLE`, `FINISHED`, `ABANDONED`)
  - `DerivedStatusFields` interface (five-field shape)
  - `deriveStatus(session, events, now)` pure derivation function (no I/O, time injected)
  - `coerceWireLastActivity(row)` helper used by both `sessions.ts` and `projects.ts`
- New storage helper `EventStore.getRecentEventsForSession(sessionId, limit)` implemented on `SqliteAdapter` as `SELECT * FROM events WHERE session_id = ? ORDER BY timestamp DESC LIMIT ?`. Indexed by the existing `idx_events_session_ts (session_id, timestamp)` compound index; cost O(min(limit, rows)).
- Existing `getEventsForSession` (ASC, filtered-timeline path) is unchanged.
- Existing `deriveSessionStatus(stoppedAt)` helper at `routes/sessions.ts:16` is unchanged. The legacy `status: 'active' | 'ended'` field stays on the wire alongside the five new fields.
- `GET /sessions/recent`:
  - Constant `DERIVED_LIMIT_THRESHOLD = 50`.
  - When `limit > 50`: skips per-row event lookups, returns placeholder derived fields (`derivedStatus = stoppedAt ? 'FINISHED' : 'WORKING'`; others null/false). New-H2 mitigation.
  - When `limit <= 50` (home view's `useRecentSessions(30)`): per-row `getRecentEventsForSession(id, 50)` + `deriveStatus(...)`. Cost is `1 + N (N <= 30)` with each per-row lookup bounded at 50 events.
- `GET /sessions/:id`: always derives. Cost 1 + 1.
- `GET /sessions/unassigned`: placeholder derived (sidebar reads legacy `status`, not `derivedStatus`).
- `GET /projects/:id/sessions`: `lastActivity` substituted with `r.last_activity ?? r.started_at` inline (Round 4 Medium mitigation; matches `/sessions/recent` wire shape).

## Response Shape

After this plan, every row from `/sessions/recent` and the body of `/sessions/:id` carry these fields:

```json
{
  "id": "sess-xyz",
  "projectId": 1,
  "projectName": "...",
  "projectSlug": "...",
  "slug": null,
  "intent": null,
  "intentSource": null,
  "transcriptPath": null,
  "startCwd": null,
  "status": "active",                         // legacy two-state; unchanged
  "startedAt": 1700000000000,
  "stoppedAt": null,
  "metadata": null,
  "agentCount": 0,
  "eventCount": 0,
  "lastActivity": 1700000000000,              // wire-coerced; never null
  "agentClasses": [],
  "derivedStatus": "WAITING_ON_PERMISSION",   // NEW
  "statusDetail": "Bash",                     // NEW
  "needsYou": true,                           // NEW
  "lastActionLabel": "Waiting on Bash permission",  // NEW
  "lastActionAt": 1700000123456               // NEW
}
```

The five new keys are appended after the existing fields. Legacy field order is preserved for consumers that iterate keys.

## Test Count

- 27 new unit tests in `app/server/src/lib/derive-status.test.ts`:
  - 6 status state cases (FINISHED, WAITING_ON_PERMISSION, WAITING_FOR_INPUT [4 variants including H6], WORKING, IDLE, ABANDONED)
  - 3 NULL last_activity fallback cases (fresh, stale, both-null)
  - 9 lastActionLabel cases per event kind + truncation + lastActionAt + empty events
  - 3 coerceWireLastActivity cases
- 8 new route-level tests in `app/server/src/routes/sessions.test.ts` covering:
  - five-new-fields-present (recent + :id)
  - C1 DESC regression (newest-first Notification classifies as WAITING_ON_PERMISSION)
  - New-H2 (`limit=10000` makes zero `getRecentEventsForSession` calls)
  - perf budget (`limit=30` makes exactly N calls each bounded at 50)
  - Round 3 New-H (null `last_activity` coerced to `started_at` on wire) on both routes
- 2 new tests in `app/server/src/routes/projects.test.ts` covering:
  - Round 4 Medium parity (`/projects/:id/sessions` matches `/sessions/recent` wire shape)

**Totals: 37 new tests added. Suite went from 327 to 364 passing server tests (1 skipped, identical to pre-change). `just check` exits 0.**

## Acceptance Criteria Verification

| Criterion | Status |
|---|---|
| `app/server/src/lib/derive-status.ts` exists; exports `deriveStatus`, `DerivedStatusFields`, `SessionStatus` | PASS |
| `app/server/src/storage/types.ts` declares `getRecentEventsForSession` on `EventStore` | PASS |
| `app/server/src/storage/sqlite-adapter.ts` implements `getRecentEventsForSession` with DESC + LIMIT (`grep -n 'ORDER BY timestamp DESC' app/server/src/storage/sqlite-adapter.ts` returns one match at line 1088) | PASS |
| Existing `getEventsForSession` untouched (still ASC) | PASS (diff: no lines inside method body changed) |
| `routes/sessions.ts` imports `deriveStatus` from `../lib/derive-status`. Existing `deriveSessionStatus` at line 16 (was line 7 pre-edit; shifted by import block) unchanged | PASS |
| Both route handlers call `store.getRecentEventsForSession`; the filtered-timeline call at line 211 still uses `getEventsForSession` | PASS |
| `npm test` exits 0 from `app/server` | PASS (364 passing, 1 skipped) |
| Manual curl returns rows with all five new keys plus legacy `status` | Logically true from route source; manual curl deferred (server start out of scope for plan execution) |
| Session with >50 events whose most recent event is a permission Notification returns `derivedStatus = 'WAITING_ON_PERMISSION'` | PASS (route test "classifies WAITING_ON_PERMISSION from a real journal Notification string returned newest-first") |
| `/sessions/recent?limit=10000` returns placeholders and makes zero per-row event lookups | PASS (route test "skips per-row derivation when limit > 50") |
| `/sessions/recent?limit=30` exercises `getRecentEventsForSession` exactly 30 times per request | PASS (route test "performs full derivation when limit <= 50") |
| Row with NULL `last_activity` emits `lastActivity = started_at` on wire | PASS (route tests on both `/sessions/recent` and `/sessions/:id`) |
| `/projects/:id/sessions` emits coerced `lastActivity`; sole emit line uses `r.last_activity ?? r.started_at` | PASS (route test + grep) |
| Derivation cost stays within `1 + N (N <= 30)` with each event lookup bounded at 50 | PASS (test asserts call count + per-call limit) |
| No em dashes (U+2014) or double-hyphen runs in new code | PASS (verified via `grep -P "\x{2014}"` on all new and modified diff lines) |
| `just check` exits 0 | PASS |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Truncation test fixture chose the wrong event kind**

- **Found during:** Task 2 (vitest output during GREEN phase)
- **Issue:** The original Task 1 truncation test used `UserPromptSubmit` with a 100+ char prompt. But the implementation slices the prompt to 50 chars first, producing `"Prompt: " + 50 chars` = 58 chars total, which never exceeds the 60-char cap. The truncation branch was never exercised by that fixture, so the test failed expecting length 60 but got 58.
- **Fix:** Changed the fixture to use an unknown hook name with a 100-char hook name string, which routes through the verbatim-passthrough default branch and triggers truncation as designed. Added an inline comment explaining why UserPromptSubmit cannot trigger truncation.
- **Files modified:** `app/server/src/lib/derive-status.test.ts`
- **Commit:** 4872c01 (included with the GREEN commit since the test fixture was authored in Task 1 but only caught during Task 2 verification)

**2. [Rule 3 - Blocking] Pre-existing mocks in `sessions.test.ts` did not stub `getRecentEventsForSession`**

- **Found during:** Task 2 (first full `npm test` run)
- **Issue:** Three `mockStore` definitions in `sessions.test.ts` were partial implementations of `EventStore`. After my change made `/sessions/recent` and `/sessions/:id` call `store.getRecentEventsForSession`, six existing tests started failing with `Cannot read properties of undefined`.
- **Fix:** Added `getRecentEventsForSession: vi.fn()` (resolving to empty events array in `beforeEach`) to the two mock stores that exercise these routes. The third mock (events endpoint) does not exercise the changed code path and was left alone.
- **Files modified:** `app/server/src/routes/sessions.test.ts`
- **Commit:** 4872c01

### Notes on plan acceptance criteria that mention specific line numbers

The plan acceptance criteria reference `function deriveSessionStatus` at line 7 and the unchanged `getEventsForSession` call at line 132. Post-edit the file got new imports and constants, shifting these to lines 16 and 211 respectively. The acceptance grep still finds them. No behavior change.

## Authentication Gates

None encountered. All work was code + tests + local filesystem; no external auth required.

## Known Stubs

None. All five new fields are wired end-to-end on both endpoints. The `/sessions/unassigned` route intentionally returns placeholder derived fields (sidebar consumers do not read `derivedStatus`); this is documented behavior and the wire shape is consistent.

## Threat Flags

No new threat surface introduced beyond what the plan's `<threat_model>` already covered. The five new fields surface short, server-derived strings (`statusDetail` capped at 64 chars; `lastActionLabel` capped at 60 chars). Plan 02 (client) will render them via React JSX (auto-escapes).

## Self-Check: PASSED

- `app/server/src/lib/derive-status.ts` exists: FOUND
- `app/server/src/lib/derive-status.test.ts` exists: FOUND
- `app/server/src/routes/projects.test.ts` exists: FOUND
- `app/server/src/routes/sessions.ts` modified: FOUND (`grep deriveStatus`)
- `app/server/src/routes/projects.ts` modified: FOUND (`grep 'r.last_activity ?? r.started_at'`)
- `app/server/src/storage/types.ts` modified: FOUND (`grep getRecentEventsForSession`)
- `app/server/src/storage/sqlite-adapter.ts` modified: FOUND (`grep 'ORDER BY timestamp DESC LIMIT'`)
- Commit 3ba4c95 (test) exists: FOUND
- Commit 4872c01 (feat) exists: FOUND
- 364 server tests pass, 237 hooks tests pass, 237 client tests pass
- `just check` exits 0
