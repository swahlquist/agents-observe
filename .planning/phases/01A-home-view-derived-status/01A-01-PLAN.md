---
phase: 01A-home-view-derived-status
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - app/server/src/routes/sessions.ts
  - app/server/src/routes/projects.ts
  - app/server/src/lib/derive-status.ts
  - app/server/src/lib/derive-status.test.ts
  - app/server/src/storage/types.ts
  - app/server/src/storage/sqlite-adapter.ts
autonomous: true
requirements: [HOME-01, HOME-02, HOME-11, HOME-12, HOME-14, HOME-15]
must_haves:
  truths:
    - "GET /sessions/recent returns derivedStatus, statusDetail, needsYou, lastActionLabel, lastActionAt on every row, alongside the existing legacy status field (which stays unchanged for the 7+ in-repo consumers still reading it)"
    - "GET /sessions/:id returns the same five derived fields"
    - "Status correctly classifies all six states (WORKING, WAITING_FOR_INPUT, WAITING_ON_PERMISSION, IDLE, FINISHED, ABANDONED) using real captured journal Notification messages"
    - "Derivation cost is structurally bounded to `1 + min(rowCount, DERIVED_LIMIT_THRESHOLD)` queries per `/sessions/recent` request, where `DERIVED_LIMIT_THRESHOLD = 50`. The home view's `useRecentSessions(30)` does derivation (1 + 30 = 31 queries); high-limit callers like settings/projects-tab's `useRecentSessions(10000)` skip derivation and return placeholder fields (1 + 0 = 1 query). Each per-row event lookup is capped at `LIMIT 50` via `getRecentEventsForSession`. No unbounded scan and no JOIN fan-out, regardless of caller. (Specific wall-clock latency is intentionally not promised as a contract; if a hard SLA is needed later, add a microbenchmark task; H4 adversary disposition.)"
    - "Derivation is O(N) over sessions (N <= 30) and O(M) over events per session (M <= 50, newest-first via getRecentEventsForSession). No full event-table scan"
  artifacts:
    - path: "app/server/src/lib/derive-status.ts"
      provides: "Pure derivation function: deriveStatus(session, events, now)"
      exports: ["deriveStatus", "DerivedStatusFields", "SessionStatus"]
    - path: "app/server/src/lib/derive-status.test.ts"
      provides: "Vitest tests using real captured journal Notification message strings"
      contains: "describe('deriveStatus'"
  key_links:
    - from: "app/server/src/routes/sessions.ts"
      to: "app/server/src/lib/derive-status.ts"
      via: "rowToRecentSession import + per-row call after a bounded getRecentEventsForSession lookup (newest-first, LIMIT 50)"
      pattern: "deriveStatus\\("
---

## Phase Goal

**As a** founder running 4 to 5 parallel agent sessions, **I want to** see at a glance which sessions need me, what each is doing right now, and which are finished, **so that** I can route my attention without reading event logs.

<objective>
Add server-side derivation of five new fields (`derivedStatus`, `statusDetail`, `needsYou`, `lastActionLabel`, `lastActionAt`) to both `GET /sessions/recent` and `GET /sessions/:id`. The legacy `status: 'active' | 'ended'` field on the response stays untouched: 7+ in-repo consumers (sidebar Unassigned bucket, settings tabs, modals, labels, session-list.tsx kept alive per CONTEXT.md § "Things to leave alone") still read it via `session.status === 'active'` and would break under a type narrowing. Phase 1b will migrate those consumers and remove the legacy field. The client redesign in Plan 02 consumes the five new fields. No schema migration. All fields computed at query time from existing `sessions` and `events` rows.

Purpose: Unblock Plan 02 (client) by shipping the wire contract first. Every Phase 1a UI behavior depends on these fields.
Output: New helper `app/server/src/lib/derive-status.ts` plus colocated test file, and wiring changes inside `app/server/src/routes/sessions.ts` that route both endpoints through the helper.
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

<task type="auto" tdd="true">
  <name>Task 1: Failing tests for deriveStatus using real captured journal messages</name>
  <files>
    - app/server/src/lib/derive-status.test.ts (new)
  </files>
  <read_first>
    - .planning/phases/01A-home-view-derived-status/01A-CONTEXT.md § "Status derivation rules"
    - .planning/phases/01A-home-view-derived-status/01A-CONTEXT.md § "Notification text parsing"
    - .planning/phases/01A-home-view-derived-status/01A-CONTEXT.md § "lastActionLabel derivation"
    - .planning/PROJECT.md lines 79 to 80 (real journal Notification message examples)
    - app/server/src/storage/sqlite-adapter.ts lines 93 to 167 (pending_notification_ts semantics)
    - app/server/package.json (confirm vitest is the runner, no extra config needed)
  </read_first>
  <behavior>
    - Test file describes `deriveStatus(session, events, now)` and asserts one passing case per status state. (Field naming note: the function returns a `DerivedStatusFields` object whose six-state classification sits under the key `derivedStatus`, NOT `status`. The legacy two-state field `status: 'active' | 'ended'` is computed separately by the existing `deriveSessionStatus(stoppedAt)` helper and is NOT produced by `deriveStatus`. Test fixtures assert against `result.derivedStatus`, not `result.status`.)
    - FINISHED: session with `stopped_at` set, regardless of activity recency, returns status FINISHED, needsYou false, statusDetail null, lastActionLabel reflects most recent event (typically "Session ended" for a SessionEnd terminal event).
    - WAITING_ON_PERMISSION: session has `pending_notification_ts` set, most recent Notification event payload message is the real string "Claude needs your permission to use Bash" (from PROJECT.md line 80). Returns status WAITING_ON_PERMISSION, needsYou true, statusDetail "Bash" (parsed tool name), lastActionLabel "Waiting on Bash permission".
    - WAITING_FOR_INPUT (attention variant): session has `pending_notification_ts` set, most recent Notification message is the real string "Claude Code needs your attention" (from PROJECT.md line 80). Returns status WAITING_FOR_INPUT, needsYou true, statusDetail null, lastActionLabel "Waiting for input".
    - WAITING_FOR_INPUT (input variant): real message "Claude is waiting for your input" (from PROJECT.md line 80). Same status, same shape.
    - WAITING_FOR_INPUT (fallback, message present): a Notification with a wholly unrecognized message string still classifies as WAITING_FOR_INPUT, with statusDetail set to the message sliced to 40 characters.
    - WAITING_FOR_INPUT (fallback, no Notification in window; H6 mitigation): session has `pending_notification_ts` set but the fetched events array contains zero events with `hook_name === 'Notification'` (e.g. the triggering Notification is older than 50 events back). Returns derivedStatus WAITING_FOR_INPUT, needsYou true, statusDetail null, lastActionLabel "Waiting for input". The server-side flag is canonical (set on every transition); trust it.
    - WORKING: no pending notification, `last_activity` is 30 seconds before `now`. Returns status WORKING, needsYou false. lastActionLabel reflects most recent event per the table in CONTEXT.md § "lastActionLabel derivation".
    - IDLE: no pending notification, `last_activity` is 15 minutes before `now`. Returns status IDLE, needsYou false.
    - ABANDONED: no pending notification, `last_activity` is 45 minutes before `now`, session not stopped. Returns status ABANDONED, needsYou false.
    - NULL `last_activity` fallback (H3 mitigation): session with `last_activity = null` and `started_at` set to 5 seconds before `now`, no pending notification, not stopped. Returns derivedStatus WORKING (substituting `started_at` for the recency calculation). A second case: `last_activity = null` and `started_at` set to 45 minutes before `now` returns derivedStatus ABANDONED. A third case: both `last_activity` and `started_at` NULL returns derivedStatus WORKING (degenerate default; per-schema unreachable but covered defensively). Guards against `now - null` coercing to `now` and miscategorizing fresh or freshly-cleared sessions as ABANDONED.
    - Wire-coercion of `lastActivity` (Round 3 New-H mitigation): a separate test, NOT inside `deriveStatus` but on the `rowToRecentSession` mapper (or wherever response composition happens). Given a session row with `last_activity = null` and `started_at = 1700000000000`, the output object's `lastActivity` field equals `1700000000000` (the `started_at` value), NOT `null`. Given a session row with `last_activity = 1700001000000` and `started_at = 1700000000000`, the output `lastActivity` equals `1700001000000` (the actual `last_activity`). This pins the wire contract so the client type `RecentSession.lastActivity: number` is not a lie.
    - lastActionLabel coverage: one test per event kind in the derivation table (BeforeTool maps to "Running <tool_name>"; AfterTool maps to "Finished <tool_name>"; UserPromptSubmit maps to "Prompt: " + first 50 chars; SessionStart maps to "Started session"; SessionEnd maps to "Session ended"; Stop maps to "Idle"; unknown hook_name passes through verbatim).
    - Label truncation: a label that would exceed 60 characters is cut to 59 + single-character ellipsis U+2026 ("…", not three dots).
    - Permission-vs-input parsing: `/needs your permission to use ([A-Za-z]+)/i` extracts the tool name; case-insensitive match for the other two patterns.
    - lastActionAt: equals the timestamp of the event used to derive lastActionLabel.
    - When events array is empty: lastActionLabel is null, lastActionAt is null, status still derives correctly from session row alone.
  </behavior>
  <action>
    Create `app/server/src/lib/derive-status.test.ts`. Use Vitest (`describe`, `it`, `expect`). Import `deriveStatus` from `./derive-status` (will not exist yet; the import failure is the first failing test signal).

    Build small fixtures for each case. A session fixture is a minimal object matching the shape returned by `getRecentSessions` rows (must include at least: `id`, `stopped_at`, `last_activity`, `pending_notification_ts`). An event fixture matches the shape returned by `getEventsForSession` rows (must include at least: `id`, `hook_name`, `timestamp`, `payload` as a JSON string).

    Pin `now` per test by passing it explicitly as the third argument to `deriveStatus`. Do not call `Date.now()` inside the test. The CONTEXT.md § "Status derivation rules" thresholds use 60 seconds for WORKING and 30 minutes for ABANDONED, which must match the implementation.

    For every Notification fixture, the `payload` string must contain a `message` field with the exact captured string from `.planning/PROJECT.md` line 80, not a paraphrase. CONTEXT.md § "Notification text parsing" requires real captured journal strings.

    Per the CONTEXT.md hard rule on em dashes, no em dashes or double-hyphen runs in any assertion message, comment, or describe/it title.

    The test file must not read `process.env` at all; env reads are restricted to `hooks/scripts/lib/config.mjs` per CLAUDE.md.
  </action>
  <acceptance_criteria>
    - Source: `app/server/src/lib/derive-status.test.ts` exists and contains a top-level `describe('deriveStatus'` block.
    - Test command (run from `app/server`): `npm test` exits non-zero before Task 2 is implemented (the helper does not exist yet, so import fails). This is the expected TDD-red signal.
    - All six status states have at least one test case using a session-row fixture; the three WAITING_FOR_INPUT and WAITING_ON_PERMISSION cases use the real captured journal strings from PROJECT.md line 80.
    - lastActionLabel has one passing test per event kind in CONTEXT.md § "lastActionLabel derivation".
    - No em dashes (U+2014) and no double-hyphen ("--") runs anywhere in the test file content.
  </acceptance_criteria>
  <verify>
    <automated>cd app/server &amp;&amp; npm test 2&gt;&amp;1 | grep -E "derive-status|FAIL|Error" | head -20</automated>
  </verify>
  <done>Test file exists, runs through Vitest, and fails for the right reason (helper module missing); confirming the TDD red phase before Task 2.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: Implement deriveStatus and wire it into both session endpoints</name>
  <files>
    - app/server/src/lib/derive-status.ts (new)
    - app/server/src/routes/sessions.ts (modify)
  </files>
  <read_first>
    - app/server/src/routes/sessions.ts (full file; focus the existing `deriveSessionStatus` at line 7 and `rowToRecentSession` at line 28; this plan replaces the former and extends the latter)
    - app/server/src/storage/sqlite-adapter.ts lines 1042 to 1075 (existing `getEventsForSession`: note the `ORDER BY timestamp ASC` then `LIMIT`, which returns the OLDEST events. That is the wrong end for status derivation, which is why Task 2 adds a new sibling helper)
    - app/server/src/storage/sqlite-adapter.ts lines 1227 to 1253 (getRecentSessions SELECT; confirms `pending_notification_ts` is included via `s.*`)
    - app/server/src/storage/sqlite-adapter.ts line 437 (index `idx_events_session_ts (session_id, timestamp)`: the compound index that serves both ASC and DESC scans of `WHERE session_id = ? ORDER BY timestamp <dir> LIMIT ?`)
    - app/server/src/storage/types.ts lines 124 to 175 (EventStore interface; Task 2 ADDS a sibling method `getRecentEventsForSession(sessionId, limit)`. Do NOT modify the existing `getEventsForSession` signature; it has another caller at sessions.ts:132 that expects ASC ordering)
    - .planning/phases/01A-home-view-derived-status/01A-CONTEXT.md § "Status derivation rules" (regex chain, thresholds, why-text)
    - .planning/phases/01A-home-view-derived-status/01A-CONTEXT.md § "Performance plan" (1 + N query budget; do not refactor the SELECT)
    - hooks/scripts/lib/config.mjs (env var policy; this task adds no env reads)
  </read_first>
  <behavior>
    - New module `app/server/src/lib/derive-status.ts` exports a pure function `deriveStatus(session, events, now)` returning `{status, statusDetail, needsYou, lastActionLabel, lastActionAt}`. The function performs zero I/O, takes `now` as a parameter (so tests can pin time), and accepts events ordered however the storage layer returns them (the function reverses internally if needed; do not assume ordering at the call site).
    - The status branches follow CONTEXT.md § "Status derivation rules" exactly: FINISHED when `stopped_at` is non-null; WAITING_ON_PERMISSION / WAITING_FOR_INPUT when `pending_notification_ts` is non-null (text-parsed); WORKING / IDLE / ABANDONED otherwise based on `last_activity` distance from `now` (60-second WORKING window, 30-minute ABANDONED cutoff). NULL handling (per CONTEXT.md § "NULL handling for `last_activity`"): when `last_activity IS NULL`, substitute `started_at` in the recency calculation; when both are NULL, default to WORKING. Without this, `now - null` coerces to `now` and miscategorizes fresh or just-cleared sessions as ABANDONED.
    - Wire-level coercion of `lastActivity` (adversary Round 3 New-H mitigation): when `rowToRecentSession` composes the response row, substitute `(row.last_activity ?? row.started_at)` for the `lastActivity` field emitted on the wire. This applies in BOTH the derivation branch and the high-limit placeholder branch. The result: clients see `lastActivity: number` (never null), matching the existing `RecentSession.lastActivity: number` type in `app/client/src/types/index.ts:117`. `started_at` is `NOT NULL` per the schema (`sqlite-adapter.ts` sessions table), so the substitution always yields a value. This avoids widening the client type to `number | null`, which would have broken three existing client call sites (`labels-modal.tsx:346` numeric sort, `labels-modal.tsx:626` and `session-modal.tsx:347` `formatRelativeTime` calls) that pass `lastActivity` into helpers typed `ts: number`. The coercion makes the existing client type honest; before this fix, the type said `number` but the wire could already emit `null` after `clearSessionEvents`, silently producing NaN at those three call sites. This is independent of the derivation rule itself (which uses the same fallback chain internally for status classification); coercion is at the response-composition step in `rowToRecentSession`, not inside `deriveStatus`.
    - Apply the SAME `(r.last_activity ?? r.started_at)` substitution at `app/server/src/routes/projects.ts:89` for the `/projects/:id/sessions` endpoint (adversary Round 4 Medium mitigation). The endpoint returns `Session`-shaped data (not `RecentSession`), and the client type `Session.lastActivity: number | null` already allows null on this path, so applying the substitution does NOT require a type change. The point is unifying wire behavior: today a session with `last_activity = null` returns `lastActivity: null` on this endpoint and `lastActivity: <started_at>` on `/sessions/recent`. After this edit both endpoints behave the same. Prevents the "future developer conflates the two endpoints and reintroduces null-arithmetic bugs" trap.
    - The text parser uses the three-regex chain from CONTEXT.md § "Notification text parsing", applied in the order listed, against the most recent Notification event's `payload.message` field. When `pending_notification_ts IS NOT NULL` but the fetched events window contains NO `Notification` event (the triggering one is older than 50 events back), default to `WAITING_FOR_INPUT` with `statusDetail = null` and `lastActionLabel = "Waiting for input"` per CONTEXT.md § "Notification text parsing" fallback 5 (H6 mitigation). Do NOT fall through to the recency cascade in this case; the server flag is canonical.
    - The `lastActionLabel` derivation walks the last 5 events backward (per CONTEXT.md § "lastActionLabel derivation"), first match wins, and truncates with single-character ellipsis (U+2026) at 60 characters.
    - `rowToRecentSession` becomes async (or accepts a precomputed `derived` argument) and is invoked from a small helper that does the per-row event lookup. Update both `GET /sessions/recent` and `GET /sessions/:id` to perform: 1 query for rows, then for each row a `store.getRecentEventsForSession(row.id, 50)` call (the NEW helper added in Task 2; returns the newest 50 events via `ORDER BY timestamp DESC LIMIT ?`, not the oldest 50), then `deriveStatus(row, events, Date.now())`, then merge the five new fields onto the response body. Derivation skip for high-limit callers (adversary New-H2 mitigation): when `/sessions/recent` is called with `limit > 50` (e.g. settings/projects-tab calls `useRecentSessions(10000)` and a future-day audit page may call with limit=500), SKIP the per-row event lookup and return placeholder derived fields: `derivedStatus = stoppedAt ? 'FINISHED' : 'WORKING'`, `statusDetail = null`, `needsYou = false`, `lastActionLabel = null`, `lastActionAt = null`. The home view's `useRecentSessions(30)` is well below the threshold and gets full derivation. This bounds the per-request event-lookup count at `min(rowCount, 50)`, preventing a `useRecentSessions(10000)` refetch (triggered by a single notification WS frame invalidating the `['recent-sessions']` prefix) from doing 10,001 SQL roundtrips. `/sessions/:id` always derives (it returns a single row; cost is 1 + 1). Field-naming resolution (per adversary H1): the legacy `status: 'active' | 'ended'` field stays on the wire AS-IS, populated by the existing `deriveSessionStatus(stoppedAt)` helper. The new six-state classification is exposed under a NEW key, `derivedStatus`, alongside `statusDetail`, `needsYou`, `lastActionLabel`, and `lastActionAt`. The adversary review identified 7+ in-repo consumers (sidebar Unassigned bucket, settings tabs, modals, labels, session-list.tsx kept alive per CONTEXT.md § "Things to leave alone") that compare `session.status === 'active'` and would break under a type narrowing; rewriting them is out of Phase 1a scope. Phase 1b will migrate consumers and remove the legacy field.
    - For `GET /sessions/:id`, also include the new fields on the response (HOME-01 requires both endpoints).
  </behavior>
  <action>
    Create the directory `app/server/src/lib/` (it does not exist yet; confirmed by `ls app/server/src/`). Write `derive-status.ts` containing:

    Exported type `SessionStatus` as the union of the six string literals from CONTEXT.md § carry_forward (`WORKING`, `WAITING_FOR_INPUT`, `WAITING_ON_PERMISSION`, `IDLE`, `FINISHED`, `ABANDONED`).

    Exported interface `DerivedStatusFields` with the five fields (`derivedStatus: SessionStatus`, `statusDetail: string | null`, `needsYou: boolean`, `lastActionLabel: string | null`, `lastActionAt: number | null`). The field name is `derivedStatus` (NOT `status`); the legacy `status: 'active' | 'ended'` field stays on the wire separately, populated by the existing `deriveSessionStatus(stoppedAt)` helper.

    Exported function `deriveStatus(session, events, now)`. `session` is typed loosely (a structural type covering `stopped_at`, `last_activity`, `pending_notification_ts`). `events` is typed loosely (structural cover for `hook_name`, `timestamp`, `payload`). `now` is a number (Unix ms).

    Inside `deriveStatus`, branch in this order: FINISHED first; then if `pending_notification_ts` is set, parse the most recent Notification message; then the recency cascade (WORKING < 60_000 ms, IDLE < 1_800_000 ms, ABANDONED otherwise). For the recency cascade, compute `referenceTs = session.last_activity ?? session.started_at ?? null`. If `referenceTs IS NULL`, short-circuit to WORKING (degenerate but safe default). Otherwise compute `age = now - referenceTs` against the thresholds. Do NOT pass `null` into a subtraction; use the nullish-coalescing chain above. Cite CONTEXT.md § "Status derivation rules" and the NULL-handling note in the function's top-of-file comment.

    Implement the regex chain exactly as CONTEXT.md § "Notification text parsing" lists. The first regex captures the tool name with `[A-Za-z]+`; statusDetail for permission is `match[1]`, never the whole message.

    Implement `lastActionLabel` per CONTEXT.md § "lastActionLabel derivation". Truncate to 60 characters by replacing the 60th character with U+2026 (single-character ellipsis); do not emit three dots. Cap `statusDetail` at 64 characters as a universal upper bound (applies to every branch including regex-captured tool names; in practice the parsed tool names are short and CONTEXT.md fallback 4 slices the unmatched-message case to 40 characters first, which is already well within the 64-char cap; the 64-char cap is the safety net, the 40-char slice is the specific case).

    Add a new method `getRecentEventsForSession(sessionId: string, limit: number): Promise<StoredEvent[]>` to the `EventStore` interface in `app/server/src/storage/types.ts`, declared adjacent to the existing `getEventsForSession` (around line 161). Implement it in `app/server/src/storage/sqlite-adapter.ts` in the block adjacent to the existing `getEventsForSession` (after line 1075). The implementation is a single prepared statement: `SELECT * FROM events WHERE session_id = ? ORDER BY timestamp DESC LIMIT ?` returning `StoredEvent[]`. No filters; this is the fast newest-N lookup that backs status derivation. Reuse the existing compound index `idx_events_session_ts (session_id, timestamp)` (line 437); SQLite serves DESC scans of a compound index efficiently with no extra index needed.

    Do NOT modify the existing `getEventsForSession` method or its ASC ordering: the filtered timeline view at `routes/sessions.ts:132` depends on ASC plus pagination semantics. The new helper is additive.

    Edit `app/server/src/routes/sessions.ts`. KEEP the existing `deriveSessionStatus` function at line 7 untouched; it continues to populate the legacy `status: 'active' | 'ended'` field on the response (H1 mitigation: 7+ in-repo consumers still read this field). Import `deriveStatus` and `DerivedStatusFields` from `../lib/derive-status`. Convert the two route handlers (`GET /sessions/recent` and `GET /sessions/:id`) so each row's events are fetched via `await store.getRecentEventsForSession(row.id, 50)` and then `deriveStatus(row, events, Date.now())` produces the FIVE new fields (`derivedStatus`, `statusDetail`, `needsYou`, `lastActionLabel`, `lastActionAt`), which are spread into the response object alongside the existing legacy fields (including legacy `status`). The `rowToRecentSession` mapper takes a second argument: the derived block. Maintain field ordering: existing fields first (including legacy `status`), new fields last. Inside `rowToRecentSession`, substitute `(row.last_activity ?? row.started_at)` for the `lastActivity` field emitted on the wire (Round 3 New-H mitigation: keeps the client type honest as `number`, avoids null guards at three existing client call sites). Apply the same substitution in the high-limit placeholder branch so the wire shape is consistent regardless of request limit.

    For `GET /sessions/recent`, define a module-local constant `DERIVED_LIMIT_THRESHOLD = 50`. If the request's `limit` is `> DERIVED_LIMIT_THRESHOLD`, skip the per-row event-lookup loop and populate the five derived fields per row with placeholders: `derivedStatus = row.stopped_at ? 'FINISHED' : 'WORKING'`, `statusDetail = null`, `needsYou = false`, `lastActionLabel = null`, `lastActionAt = null`. If `limit <= DERIVED_LIMIT_THRESHOLD`, fetch events for each row in a single loop (the SELECT in `getRecentSessions` already caps N at the requested limit, so this is N event-table lookups, each capped at 50 rows by the compound index `idx_events_session_ts (session_id, timestamp)`, which serves `ORDER BY timestamp DESC LIMIT 50` via reverse scan). Do not introduce a JOIN or a fan-out query rewrite; keep the existing SELECT untouched per CONTEXT.md § "Performance plan".

    For `GET /sessions/:id`, do the same: one row, one events lookup, one `deriveStatus` call.

    Edit `app/server/src/routes/projects.ts`. In the `/projects/:id/sessions` handler at line 71, locate the `.map((r: any) => ({...}))` block around line 77. Change line 89 from `lastActivity: r.last_activity,` to `lastActivity: r.last_activity ?? r.started_at,`. This is the only change to that file. The endpoint stays inline (does NOT route through `rowToRecentSession`) because it returns `Session`-shaped data with different fields; the substitution is the single behavior we unify across the two endpoints. Document the rationale inline with a brief comment if it helps a future reader.

    Do not change the `pending_notification_ts` write path (the `startSessionNotification` / `clearSessionNotification` flow in the storage layer). Reads only, per CONTEXT.md § "Things to leave alone".

    No em dashes in any user-facing label string (specifically the lastActionLabel branches and statusDetail fallback). Per CLAUDE.md, em dashes are banned everywhere Scot may publish or paste.
  </action>
  <acceptance_criteria>
    - Source: `app/server/src/lib/derive-status.ts` exists and exports `deriveStatus`, `DerivedStatusFields`, `SessionStatus`.
    - Source: `app/server/src/storage/types.ts` declares `getRecentEventsForSession(sessionId: string, limit: number): Promise<StoredEvent[]>` on the `EventStore` interface.
    - Source: `app/server/src/storage/sqlite-adapter.ts` implements `getRecentEventsForSession` with a `SELECT * FROM events WHERE session_id = ? ORDER BY timestamp DESC LIMIT ?` prepared statement. Confirm via `grep -n "ORDER BY timestamp DESC" app/server/src/storage/sqlite-adapter.ts`.
    - Source: `app/server/src/storage/sqlite-adapter.ts` `getEventsForSession` is untouched (still `ORDER BY timestamp ASC`); confirm via `git diff` that no lines inside the existing method body changed.
    - Source: `app/server/src/routes/sessions.ts` imports `deriveStatus` from `../lib/derive-status`. The existing `deriveSessionStatus` helper at line 7 is UNCHANGED and continues to populate the legacy `status: 'active' | 'ended'` field on every response (H1 mitigation: do NOT delete it). Both route handlers call `store.getRecentEventsForSession(row.id, 50)` (NOT `getEventsForSession`); confirm via `grep -nE "getRecentEventsForSession|getEventsForSession|function deriveSessionStatus" app/server/src/routes/sessions.ts` (expect: 2 matches for the new helper, 1 unchanged match at line 132 for the existing filtered-timeline call, AND 1 unchanged match for `function deriveSessionStatus` at line 7).
    - Test command (from `app/server`): `npm test` exits 0; the file `derive-status.test.ts` from Task 1 now passes.
    - Behavior: a manual curl against `/api/sessions/recent` after the server restarts returns rows where every row has the keys `status` (legacy two-state, unchanged from main), `derivedStatus` (new six-state), `statusDetail`, `needsYou`, `lastActionLabel`, `lastActionAt`. (Manual sanity check; the test suite covers correctness.)
    - Behavior: for a session with more than 50 events whose most recent event is a permission Notification, the returned `derivedStatus` is `WAITING_ON_PERMISSION` and `lastActionLabel` reflects the most recent event (not the oldest event in the table). This is the regression check for C1: confirm a real DESC scan, not an ASC scan with the wrong end. Legacy `status` for the same session is `'active'` (unchanged behavior).
    - Behavior: `/sessions/recent?limit=10000` returns rows where every row has the five new derived fields PRESENT but populated with placeholders (`derivedStatus = 'WORKING'` or `'FINISHED'` per `stopped_at`; the other four fields all `null` or `false`), and the response is produced WITHOUT any per-row event-table lookups. Confirm via server log or a vitest spec that exercises the route with `limit=10000` against a seeded DB containing >5 sessions and asserts `getRecentEventsForSession` was called zero times (mock or spy). This is the regression check for New-H2 (avoiding the 10,001-query storm under TanStack prefix invalidation).
    - Behavior: `/sessions/recent?limit=30` (the home view's call) returns rows with full derivation: derived fields reflect real status, and the test path exercises `getRecentEventsForSession` exactly 30 times per request.
    - Behavior: for a session row whose underlying `sessions.last_activity` column is NULL (e.g. just after `clearSessionEvents`), the wire response field `lastActivity` is the row's `started_at` value, NOT null. Vitest spec on the route handler with a seeded row matching this state asserts `response.lastActivity === row.started_at`. This is the regression check for Round 3 New-H: prevents the type lie (`RecentSession.lastActivity: number` claiming non-null while the wire emits null) that would surface as NaN at `labels-modal.tsx:346` (numeric sort) and `formatRelativeTime` callers.
    - Behavior: `/projects/:id/sessions` (NOT a `RecentSession` endpoint) emits the same coerced `lastActivity` for a row whose `last_activity` is NULL. Confirm via `grep -n "lastActivity" app/server/src/routes/projects.ts`: the only `lastActivity` emit line uses `r.last_activity ?? r.started_at`. This is the Round 4 Medium mitigation: unifies wire behavior across the two endpoints that consume `getSessionsForProject` / `getRecentSessions`. Vitest spec or manual curl confirms parity.
    - Perf budget: derivation does not introduce any query beyond `1 + N` with N <= 30 and `LIMIT 50` per event lookup. Reviewer can `grep -n "getRecentEventsForSession\|store\\." app/server/src/routes/sessions.ts` and confirm no scan-style queries appear in either route handler.
    - No em dashes (U+2014) or double-hyphen ("--") runs in any string literal in `derive-status.ts` or in the new code added to `sessions.ts`.
  </acceptance_criteria>
  <verify>
    <automated>cd app/server &amp;&amp; npm test</automated>
  </verify>
  <done>Both endpoints return the five new fields, all unit tests pass, and the derivation cost stays within the documented `1 + N (N<=30)` query budget with each event lookup bounded to 50 rows.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries
| Boundary | Description |
|---|---|
| Local Claude Code hook to server | Hooks POST events via `observe_cli.mjs`; payload originates from a locally trusted process tree. |
| Server to dashboard client | The dashboard runs on `localhost:4981` in single-user mode; the wire payload here is rendered by React on the same host. |
| SQLite read path | Read-only here. The write path (`startSessionNotification` / `clearSessionNotification`) is untouched; only its column output is consumed. |

## STRIDE Threat Register
| Threat ID | Category | Component | Disposition | Mitigation Plan |
|---|---|---|---|---|
| T-01A-01-01 | I | `statusDetail` string surfaced unsanitized to the client | mitigate | Cap `statusDetail` length at 64 characters in `derive-status.ts`. React JSX auto-escapes when Plan 02 renders it; no `dangerouslySetInnerHTML` is introduced. |
| T-01A-01-02 | D | Regex chain over attacker-controlled Notification message text | accept | Hooks are local; an external attacker has no path to drive Notification text. Regex set is bounded (3 patterns, anchored on short prefixes, no catastrophic backtracking patterns). |
| T-01A-01-03 | I | `lastActionLabel` could surface a long user prompt slice | mitigate | Truncate to 60 characters with single-character ellipsis per CONTEXT.md § "lastActionLabel derivation". |
| T-01A-01-04 | D | Per-row `getRecentEventsForSession` fan-out on `/sessions/recent`, especially when a notification WS frame invalidates the `['recent-sessions']` prefix and a high-limit cached query like settings/projects-tab's `useRecentSessions(10000)` refetches | mitigate | Per-row event lookup is gated on `limit <= DERIVED_LIMIT_THRESHOLD` (50); above the threshold the route skips derivation and returns placeholder fields. So `/sessions/recent?limit=30` = 31 queries; `/sessions/recent?limit=10000` = 1 query. Each derivation lookup is `LIMIT 50` and indexed by `idx_events_session_ts (session_id, timestamp)`, which serves the `ORDER BY timestamp DESC LIMIT 50` plan via reverse scan. Confirmed budget in CONTEXT.md § "Performance plan". |
| T-01A-01-05 | T | Legacy `status` field and new `derivedStatus` field drift out of sync on the wire | accept | Both fields are computed at request time from the same `sessions` row (`stopped_at` drives legacy via `deriveSessionStatus`; `stopped_at` plus events drives derived via `deriveStatus`), so they cannot diverge for the same response. The two fields can show conceptual disagreement (e.g. legacy `'active'` while derived is `'ABANDONED'`); this is by design (legacy = "process is not stopped"; derived = "process is stopped or stale"). Phase 1b migration removes the legacy field entirely, eliminating the drift class. |
</threat_model>

<verification>
- `cd app/server && npm test` exits 0.
- `just check` from the repo root exits 0.
- Manual smoke: start the server (`just start`), then `curl -s http://localhost:4981/api/sessions/recent | jq '.[0] | keys'` lists `status`, `statusDetail`, `needsYou`, `lastActionLabel`, `lastActionAt` among the keys.
- Manual smoke: `curl -s http://localhost:4981/api/sessions/<some-id> | jq 'keys'` lists the same five keys on a single-session response.
- Spot-check that `/today` script output (`~/ai-company-brain/scripts/today-summary.sh`) and the same data fetched from `/sessions/recent` agree on which sessions are active and which are awaiting input (HOME-15 parity check; manual visual diff per CONTEXT.md § acceptance_for_phase item 5).
</verification>

<success_criteria>
1. Every row from `GET /sessions/recent` carries the legacy `status` field unchanged, plus the five new derived fields `derivedStatus`, `statusDetail`, `needsYou`, `lastActionLabel`, `lastActionAt`. (HOME-01)
2. `GET /sessions/:id` carries the same five derived fields plus the legacy `status` field. (HOME-01)
3. All six status states are exercised by at least one passing test that uses a real captured journal Notification string for the WAITING branches. (HOME-02, HOME-11)
4. Recency thresholds match CONTEXT.md (60 second WORKING window, 30 minute ABANDONED cutoff). (HOME-11)
5. Derivation cost stays `1 + N` queries with `N <= 30` and `LIMIT 50` per event lookup; no full event-table scan. (HOME-12)
6. `just check` passes.
</success_criteria>

<output>
After completion, create `.planning/phases/01A-home-view-derived-status/01A-01-SUMMARY.md` summarizing what shipped, the test count, the response shape, and any deviations from CONTEXT.md (expected: none).
</output>
