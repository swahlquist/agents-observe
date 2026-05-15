# Phase 1a Context: Home View + Derived Status

**Phase:** 1a
**Name:** Home View + Derived Status
**Mode:** mvp
**Captured:** 2026-05-13
**Discussion mode:** auto (decisions Claude-resolved from prior alignment; user can redirect any item)

<domain>
This phase delivers a glance-readable founder-mode home view of `agents-observe`. The current "recent sessions" list is replaced with:

1. A Needs You pile at the top.
2. Project groups containing active sessions, each rendered as a card.
3. A Finished today section.
4. The Notion Today panel moved to the bottom.

The server begins returning five new fields on every session payload — `status`, `statusDetail`, `needsYou`, `lastActionLabel`, `lastActionAt` — all derived at query time from existing tables. No schema migration. Side effects: tab title is written when `needsYou` flips, and an audible bell plays once (mutable via UI toggle).

**Out of scope here, comes in Phase 1b:** the `tasks` table, `/lingo` task writes, `category` and `color` columns, real Overview-tab content. Phase 1a uses client-side category/color derivation so the redesign ships before the data model changes.
</domain>

<carry_forward>
Locked in PROJECT.md and REQUIREMENTS.md (do not re-decide):

- Status states: `WORKING`, `WAITING_FOR_INPUT`, `WAITING_ON_PERMISSION`, `IDLE`, `FINISHED`, `ABANDONED`.
- All status fields derived at query time on `GET /sessions/recent` and `GET /sessions/:id`. Not stored.
- `needsYou` flip triggers: unconditional `document.title` write + audible bell (default on, UI toggle to mute).
- Layout order: Needs You → project groups → Finished today → Notion Today.
- Card surfaces: status badge, category icon, color stripe, intent, client badge (claude / gemini), `lastActionLabel`, relative time.
- SessionView gets two tabs: "Overview" (default, placeholder in 1a) and "Activity" (existing event timeline).
- No em dashes in any user-facing string.
- Branch from `main`. Conventional Commits.
- Performance: O(N) over sessions (N ≤ 30), O(M) over events per session (M ≤ 50). No full event-table scan.
</carry_forward>

<canonical_refs>
- `.planning/PROJECT.md` — domain, validated/active requirements, key decisions
- `.planning/REQUIREMENTS.md` — HOME-01 through HOME-15
- `.planning/ROADMAP.md` — phase goal, success criteria, suggested plan structure (server + client split)
- `app/server/src/storage/sqlite-adapter.ts:93-167` — existing `pending_notification_ts` mechanism is the load-bearing primitive for `needsYou`
- `app/server/src/routes/sessions.ts:7-94` — `deriveSessionStatus` and `rowToRecentSession` are the points where the new derived fields land
- `app/client/src/components/main-panel/home-page.tsx` — current home view, will be rewritten
- `app/client/src/components/main-panel/session-list.tsx` — existing row renderer, will be replaced by `session-card`
- `app/client/src/stores/ui-store.ts:152-153,466-470` — existing `notificationsEnabled` toggle pattern; reuse for `bellEnabled`
- `app/client/src/hooks/use-pulse-active.ts` — existing pulse infrastructure; do not duplicate, do not bypass
- `app/client/src/hooks/use-recent-sessions.ts` — single payload hook; the five new fields ride this same query (no second hook)
- `~/ai-company-brain/scripts/today-summary.sh` — parity reference for HOME-15 visual-parity acceptance test
- `hooks/scripts/lib/config.mjs` — env var central; no `process.env` reads elsewhere (project constraint)
</canonical_refs>

<decisions>

### Status derivation rules

| State | Trigger |
|---|---|
| `FINISHED` | `sessions.stopped_at IS NOT NULL` |
| `WAITING_ON_PERMISSION` | `pending_notification_ts IS NOT NULL` AND notification text matches `/needs your permission/i` |
| `WAITING_FOR_INPUT` | `pending_notification_ts IS NOT NULL` AND not permission (catches "needs your attention", "waiting for your input") |
| `WORKING` | `pending_notification_ts IS NULL` AND `last_activity >= now - 60s` AND not finished |
| `IDLE` | `pending_notification_ts IS NULL` AND `last_activity` between `now - 30min` and `now - 60s` |
| `ABANDONED` | `pending_notification_ts IS NULL` AND `last_activity < now - 30min` AND not finished |

**NULL handling for `last_activity`:** the column is `NULL` for very new sessions (rows inserted before any event arrives) and for sessions whose events were cleared via `clearSessionEvents` (the storage layer explicitly sets `last_activity = NULL`). For the recency cascade above (WORKING / IDLE / ABANDONED), substitute `started_at` whenever `last_activity IS NULL`. If both are NULL (truly degenerate; should not occur in practice), default to `WORKING`. Without this fallback, JavaScript's `now - null` coerces to `now` and pushes the session straight into `ABANDONED`, which is wrong for a brand-new or just-cleared session.

`needsYou` = status in (`WAITING_FOR_INPUT`, `WAITING_ON_PERMISSION`).

**Why these thresholds:**
- 60s `WORKING` window matches the existing pulse decay timer in `ACTIVITY_CONFIG.pulseDurationMs`.
- 30min `IDLE`-to-`ABANDONED` cutoff matches the existing overlap-detection 30-min window. One number, one place to tune.

**Why permission-vs-input is parsed from text, not stored:**
The journal already contains the message string. Storing a parsed category would mean a migration and a synchronization point. Parsing on read is O(1) per session and survives wording drift in future Claude Code releases.

### Notification text parsing

Single regex chain, applied in order, against the message field of the most recent unhandled `Notification` event:

1. `/needs your permission to use ([A-Za-z]+)/i` → `WAITING_ON_PERMISSION`, `statusDetail = match[1]` (the tool name)
2. `/needs your attention/i` → `WAITING_FOR_INPUT`, `statusDetail = null`
3. `/waiting for your input/i` → `WAITING_FOR_INPUT`, `statusDetail = null`
4. fallback (message present but unrecognized) → `WAITING_FOR_INPUT`, `statusDetail = message slice 0..40`
5. fallback (`pending_notification_ts IS NOT NULL` but NO Notification event found in the fetched 50-event window) → `WAITING_FOR_INPUT`, `statusDetail = null`, `lastActionLabel = "Waiting for input"`. The Notification that triggered the flag could be older than 50 events back; the server flag is canonical (it's set on every transition), so trust it and default to the input branch when text isn't available.

Tests must use real captured journal strings, not invented ones.

### `lastActionLabel` derivation

Read up to last 5 events for the session, working backward. First match wins.

| Event | Label |
|---|---|
| `BeforeTool` | `"Running <tool_name>"` |
| `AfterTool` | `"Finished <tool_name>"` |
| `UserPromptSubmit` | `"Prompt: <first 50 chars of prompt>"` |
| `Notification` (permission) | `"Waiting on <tool> permission"` |
| `Notification` (other) | `"Waiting for input"` |
| `SessionStart` | `"Started session"` |
| `SessionEnd` | `"Session ended"` |
| `Stop` | `"Idle"` |
| anything else | the event's `hook_name` |

`lastActionAt` = the event's timestamp. No label longer than 60 characters; truncate with single-character ellipsis (`…` U+2026, not `...`).

### `needsYou` flip side effects (client)

- **Tab title:** unconditional. Format:
  - `N=0` → `agents-observe`
  - `N=1` → `(1) <session.intent or "needs you"> · agents-observe`
  - `N>1` → `(<N>) sessions need you · agents-observe`
  No em dash in any branch. The middle dot (`·` U+00B7) is intentional and not an em dash.
- **Audible bell:** default on. Single sine tone, 800 Hz, 150 ms, generated via Web Audio API. No external asset. Mute toggle persists in `ui-store` next to existing `notificationsEnabled` (new field `bellEnabled`, defaults to `true`, localStorage key `agents-observe-bell`). Reuse the `notificationsEnabled` pattern verbatim — same set/get shape, same localStorage convention.
- The bell plays once per flip (false → true). It does not replay on every notification while needsYou stays true.

### Card visuals

- **Color stripe** — 8-color palette (LingoLinq brand-safe; no Anthropic colors). Stable per session via `hash(session_id) % 8`. Render as a 3px vertical bar on the leading edge of the card.
- **Category icon** — client-derived from the intent text via keyword match, fallback `Terminal` icon. Match list (case-insensitive):
  - `fix`, `bug`, `repair`, `broken` → `Wrench`
  - `feat`, `add`, `build`, `implement`, `new` → `Sparkles`
  - `doc`, `audit`, `explain`, `understand`, `walk` → `BookOpen`
  - `deploy`, `release`, `ship`, `push` → `Rocket`
  - `refactor`, `clean`, `tidy` → `Brush`
  - `test`, `spec` → `FlaskConical`
  - default → `Terminal`
  All icons from `lucide-react` (already a dependency).
- **Status badge** — color + label, no icon overload. Palette:
  - WORKING → green
  - WAITING_FOR_INPUT → amber
  - WAITING_ON_PERMISSION → red
  - IDLE → muted gray
  - FINISHED → blue
  - ABANDONED → dim gray, slightly transparent
- **Client badge** — small pill, "claude" or "gemini" (derived from `agent_classes[0]`). Hide when there's only one client across the whole dashboard (single-client mode).

### Sections and ordering

- **Needs You pile** — sorted by most-recent `pending_notification_ts` first. If empty, show `"All clear. Nothing needs you."` and collapse to a 1-line subtle row instead of taking a full section.
- **Project groups** — sorted alphabetically by project name. Each group shows project name + active count + finished-today count in the header. Expanded by default in 1a. No persistence in 1a (defer to Phase 1b or later).
- **Finished today** — collapsed by default. Definition: `stopped_at >= local midnight today` (computed client-side using `Intl.DateTimeFormat` and `Date`). Shows count in collapsed header.
- **Notion Today panel** — bottom. Still hides when env unset (no behavior change to `ExternalTasksPanel` other than position).
- **Overlap banner** — keep at the very top above the Needs You pile (current placement is correct, no change).

### Empty states

- No sessions at all → `"No sessions yet. Run a Claude Code or Gemini CLI command to see it here."`
- No `needsYou` and no active sessions, only finished → `"All quiet. Nothing active."`
- All sessions finished today (none open) → Finished today shows expanded by default (its count > 0 and active count = 0).

### SessionView tabs

- New `Overview` tab is default. Body in 1a: short placeholder card listing intent (editable inline), `lastActionLabel`, status badge, and a `"Tasks: arriving in Phase 1b"` note. The existing event timeline body moves into a tab labeled `Activity` — identical content and behavior to today, just behind a tab.
- Tab state lives in URL query (`?tab=overview` / `?tab=activity`) so deep links survive reload. Default if absent is `overview`.

### Performance plan

- Server: one call to `getRecentSessions(30)` (already exists), then for each row a bounded `getEventsForSession(sessionId, limit=50)` call. Total: 1 + 30 SQL roundtrips, all indexed. Status derivation is pure CPU after that. Target end-to-end < 50 ms on the typical local DB.
- Client: status derivation does NOT recompute on every keystroke. The new fields arrive in the existing TanStack Query payload; cache shape is backwards-compatible. WebSocket invalidation re-fetches as today.

</decisions>

<deferred_ideas>
Captured during 1a scoping, not in scope for 1a; do not implement here.

- Per-project group collapsed-state persistence (Phase 1b or later)
- Bell sound asset chooser (multiple tones, user picks) — Phase 2 polish
- Status-aware row sorting (e.g., needsYou first, then WORKING, then IDLE) inside a project group — defer until we see real data
- Service-worker push notifications when `needsYou` flips — Phase 2 (PUSH-01)
- Context window % per session — depends on token tracking, deferred
- Remote terminal / multi-user view — Phase 2 (REMOTE-01..03)
- Upstream rebase against `simple10/agents-observe` v0.9.5 — separate chore branch after Phase 1b
</deferred_ideas>

<code_context>

### Reusable assets

- `ui-store.notificationsEnabled` pattern (`stores/ui-store.ts:152-153,466-470`) — clone this for `bellEnabled`. Same set/get shape, same localStorage convention.
- `pending_notification_ts` column + `startSessionNotification` / `clearSessionNotification` (`storage/sqlite-adapter.ts:93-167`) — already exists. Just read it; do not change the write path.
- `useRecentSessions` hook (`hooks/use-recent-sessions.ts`) — extend the response type; do not split into a new hook.
- `lucide-react` icons — already imported throughout; safe to use any icon in the dependency.
- `useSessionPulseActive` (`hooks/use-pulse-active.ts`) — keep working in the new card. The status dot can pulse on the existing counter without new infrastructure.

### Patterns to follow

- Server route handlers return rows via `rowToRecentSession`; add five new fields there. Don't fork a second mapper.
- All env vars centralized in `hooks/scripts/lib/config.mjs`. Never read `process.env` elsewhere — even in new code.
- File naming: kebab-case throughout (`needs-you-pile.tsx`, `project-group.tsx`, `session-card.tsx`, `finished-today.tsx`, `use-bell.ts`, `use-tab-title.ts`).
- Tests live next to source (`*.test.ts(x)`). Use Vitest. Add new tests for: status derivation (one test per state, plus permission/input parser), tab-title formatter, bell-fire-once logic.

### Integration points

- Server: `app/server/src/routes/sessions.ts` (add fields), possibly a new helper file `app/server/src/lib/derive-status.ts` for clarity.
- Client: `app/client/src/components/main-panel/home-page.tsx` (rewrite), new components under `app/client/src/components/main-panel/` (`needs-you-pile`, `project-group`, `session-card`, `finished-today`). `app/client/src/hooks/use-bell.ts`, `app/client/src/hooks/use-tab-title.ts`. `ui-store.ts` gains `bellEnabled` + setter.

### Things to leave alone

- The WebSocket transport layer. The new fields piggyback on existing payloads.
- The `pending_notification_ts` write path. Reading it is safe; rewriting it is out of scope and risks regressions on the existing notification bell in the sidebar.
- `SessionList` is not deleted in 1a — it still backs `ProjectView` until Phase 1b. Reuse where possible.
</code_context>

<acceptance_for_phase>
From REQUIREMENTS.md and ROADMAP.md success criteria:

1. Opening `localhost:4981` shows: Needs You (or empty-state line), grouped projects with collapsible sections + active and finished-today counts, Finished today section, Notion Today at bottom, in that order.
2. Every visible session card renders status badge, category icon, color stripe, intent, client badge, `lastActionLabel`, and time without overflow at 1280px and 1920px widths.
3. When a session emits a Notification, the browser tab title updates within 1 second and the audible bell plays once (when unmuted).
4. `GET /sessions/recent` returns `status`, `statusDetail`, `needsYou`, `lastActionLabel`, `lastActionAt` on every row. Existing fields unchanged. Tests cover all six status states using real journal Notification strings.
5. `/today` script and the new home view agree on which sessions are active and which need attention (visual parity, manually verified by running the script and the dashboard side by side).
6. `just check` passes. No em dashes anywhere in UI strings or new test assertion strings.
</acceptance_for_phase>

<next_steps>
- `/clear` to free context, then `/gsd-plan-phase 1a` to generate the implementation plan.
- After plan exists, run `/adversary-review` on it (CLAUDE.md hard rule). Block on Critical/High findings.
- Then `/gsd-execute-phase 1a`.
</next_steps>

---
*Phase 1a context captured: 2026-05-13. Discussion mode: auto. User-redirectable decisions flagged in `<decisions>`.*
