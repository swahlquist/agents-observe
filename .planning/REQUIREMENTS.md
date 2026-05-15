# Requirements: Founder-Mode Home View + Task/Session Tracking (v1)

**Defined:** 2026-05-13
**Core Value:** Open the dashboard, see at a glance which sessions need me, what each one is doing right now, and which work units span multiple sessions, without reading any code or event logs.

## v1 Requirements

Requirements for the v1 redesign, split across Phase 1a (UI + derived status) and Phase 1b (tasks layer + writes).

### Home View — Status Derivation (Phase 1a)

- [ ] **HOME-01**: Server returns `derivedStatus`, `statusDetail`, `needsYou`, `lastActionLabel`, `lastActionAt` on every session payload (`GET /sessions/recent` and `GET /sessions/:id`), derived at query time with no schema change. The legacy `status: 'active' | 'ended'` field on the same payload stays unchanged for backwards compatibility with the 7+ in-repo consumers that still read it; Phase 1b migrates those and removes the legacy field.
- [ ] **HOME-02**: Status derivation correctly classifies real Notification messages from the journal: messages containing "permission" map to `WAITING_ON_PERMISSION` with the parsed tool name in `statusDetail`; other notifications map to `WAITING_FOR_INPUT` with the message as `statusDetail`. Both set `needsYou=true`.
- [ ] **HOME-11**: Status derivation classifies sessions in this priority order: (1) `FINISHED` when `stopped_at IS NOT NULL`, regardless of recency; (2) `WAITING_ON_PERMISSION` or `WAITING_FOR_INPUT` when `pending_notification_ts IS NOT NULL` (sub-state derived from the most recent Notification event's message text per HOME-02); (3) recency cascade against `last_activity` versus now: `< 60s` is `WORKING`, `60s` to `30m` is `IDLE`, `> 30m` is `ABANDONED`. The 30min IDLE-to-ABANDONED cutoff matches the existing overlap-detection window so there is one tuning knob. When `last_activity IS NULL` (legitimate for very new sessions and after `clearSessionEvents`), the recency cascade substitutes `started_at`; if both are NULL (degenerate), default to `WORKING`.
- [ ] **HOME-12**: Derivation is O(N) over sessions and O(M) over the last 50 events per session. No full event-table scan on a `/sessions/recent` call.

### Home View — Layout and Sections (Phase 1a)

- [ ] **HOME-03**: Top of home view shows a "Needs You" pile populated from sessions where `needsYou=true`, sorted by most recent notification timestamp, with empty state when none qualify.
- [ ] **HOME-04**: Remaining sessions group by project. Each group header is collapsible and shows active count and finished-today count. Groups default expanded for projects with activity in the last 24h, collapsed otherwise.
- [ ] **HOME-06**: A "Finished today" section appears below project groups, collapsed by default, listing sessions whose status is `FINISHED` and whose `stopped_at` is later than midnight local time.
- [ ] **HOME-07**: The existing Notion "Today" panel moves from above the session list to the bottom of the home view. It still hides when the bridge env is unset.

### Home View — Session Card (Phase 1a)

- [ ] **HOME-05**: Each session renders as a card with status badge, category icon (derived client-side from a placeholder mapping in Phase 1a), color left-stripe (hashed from `session_id` in 1a), intent label as primary title, client badge (claude vs gemini), `lastActionLabel`, and relative time. Card is clickable to enter SessionView.
- [ ] **HOME-13**: Status badge color and text reflect the derived status: `WORKING` (green), `WAITING_FOR_INPUT` (amber), `WAITING_ON_PERMISSION` (amber with tool name), `IDLE` with elapsed time, `FINISHED` (grey, in the Finished section), `ABANDONED` (grey, dimmer).

### Home View — Side Effects (Phase 1a)

- [ ] **HOME-08**: When any visible session's `needsYou` flips false to true, `document.title` updates to `(N) <top session intent> · agents-observe`. Unconditional. Resets when all needsYou clear.
- [ ] **HOME-09**: When any visible session's `needsYou` flips false to true, an audible bell plays a short single tone (under 800ms). UI store toggle controls mute; default is unmuted. Toggle state persists across reloads.

### Session View — Tab Restructure (Phase 1a)

- [ ] **HOME-10**: SessionView gains an "Overview" tab as the default and renames the existing event timeline area to "Activity". In Phase 1a, Overview can be a thin shell (intent + needs-you dismiss); real content lands in Phase 1b under TASK-10.

### Acceptance — Phase 1a

- [ ] **HOME-14**: When Scot opens `localhost:4981`, he can identify the status of every active session in under two seconds without clicking any row.
- [ ] **HOME-15**: `/today` script output and the new home view agree on the set of active sessions and which ones need attention (visual parity, manual acceptance).

### Tasks — Schema and Migration (Phase 1b)

- [ ] **TASK-01**: New `tasks` table created with fields: `id` (uuid PK), `title` TEXT NOT NULL, `description` TEXT, `status` TEXT NOT NULL ('open'|'done'|'abandoned'), `source` TEXT ('lingo'|'manual'|'migrated'|'notion'|'webhook'), `external_ref` TEXT, `project_id` INTEGER nullable FK to `projects(id)`, `created_at` INTEGER NOT NULL, `completed_at` INTEGER, `metadata` TEXT JSON. Migration is idempotent via `IF NOT EXISTS`.
- [ ] **TASK-02**: New `session_task_links` table created with composite PK `(session_id, task_id)` and `linked_at`, `link_source` columns. ON DELETE CASCADE on both FKs.
- [ ] **TASK-03**: `sessions` table gains `category` TEXT and `color` TEXT columns. Additive ALTER. Existing rows backfill `color` from a hash of `session_id`.
- [ ] **TASK-04**: One-time idempotent migration creates one task per row in `projects.goals` JSON. New tasks set `source='migrated'`, `project_id` from the project, `status` from the goal's `done` flag, `metadata.migrated_from_goal_id` = the goal id. Re-running the migration does not duplicate.

### Tasks — API (Phase 1b)

- [ ] **TASK-05**: New routes mounted: `GET /api/tasks` (query params: `project_id`, `status`), `POST /api/tasks` (create), `GET /api/tasks/:id` (returns task + linked sessions with current derived status), `PATCH /api/tasks/:id` (update title/status/metadata), `POST /api/sessions/:id/link-task` (link existing task), `DELETE /api/sessions/:id/link-task/:tid` (unlink).
- [ ] **TASK-06**: Every task mutation broadcasts `tasks_update` and every link mutation broadcasts `task_links_update` on the existing WebSocket. Clients invalidate the relevant TanStack Query cache key on receipt.
- [ ] **TASK-13**: The existing `ProjectGoalsPanel` continues to render goals the same way for users but is now backed by the `tasks` table filtered to `project_id = ?` and `source IN ('lingo','manual','migrated')`. No UX regression.

### `/lingo` Integration (Phase 1b)

- [ ] **TASK-07**: On every `/lingo` invocation, after bucket classification and before workflow execution, a task is created via `POST /api/tasks` with title from `derive_label(prompt)`, description = first 200 chars of the prompt, `source='lingo'`, `metadata.bucket` set, `project_id` from the resolved session's project.
- [ ] **TASK-08**: `/lingo` resolves the current session via the same order as `/intent`: `$CLAUDE_SESSION_ID` → cwd match → most-recent-active fallback. Resolution failure does not block the workflow; the task is created with `project_id=null`.
- [ ] **TASK-16**: After task creation, `/lingo` links the task to the current session via `POST /api/sessions/:id/link-task` with `link_source='lingo'`.
- [ ] **TASK-17**: When the resolved session has `intent_source` of `auto` or null, `/lingo` updates the session intent to the new task title via the existing `PATCH /api/sessions/:id` route. Sticky-manual intents are not overwritten.
- [ ] **TASK-18**: `/lingo` sets the session's `category` from a fixed bucket-to-category map (A→understand, B→change-major, C→change-minor, D→infra, E→compliance, F→ship, G→question, H→unsorted). Also sets `color` if null.
- [ ] **TASK-09**: Tasks with `metadata.bucket='G'` (pure question) auto-close on the next `SessionEnd` event for the linked session. Status becomes `done`.

### Task Views (Phase 1b)

- [ ] **TASK-10**: SessionView's Overview tab renders real content: linked tasks list, editable intent, category, color, project goal progress for the session's project, last-five-actions summary derived from the most recent tool calls, and a needs-you dismiss button.
- [ ] **TASK-11**: New `/tasks` route renders a list of all tasks. Filter by `project_id`, by `status`, sortable by `created_at` and `completed_at`. Default filter shows open tasks across all projects, sorted by most recent.
- [ ] **TASK-12**: New `/tasks/:id` route renders task title, description, status (with edit), source, project link, the audit trail of status changes, and a linked-sessions block that reuses the existing `SessionList` component (each row shows current derived status).

### Acceptance — Phase 1b

- [ ] **TASK-14**: Scot can pull up `/tasks`, filter to open tasks for one project, and see every `/lingo`-created task he has launched.
- [ ] **TASK-15**: Clicking a task in `/tasks/:id` shows every session that has worked on it with each session's current status. The bucket-G auto-close rule fires on `SessionEnd` and a follow-up `/lingo` for a closed question does not reopen it.

## v2 Requirements

Deferred to a future milestone. Acknowledged, not in this roadmap.

### Notifications

- **PUSH-01**: Service-worker browser push when `needsYou` flips on a session, with deep-link to the session view.
- **PUSH-02**: Configurable notification grouping (per project, per category).

### Observability

- **OBS-01**: Context window percentage per session, surfaced on the session card and in the Overview tab.
- **OBS-02**: Token usage roll-up per task (sum across linked sessions).

### Remote and Multi-User

- **REMOTE-01**: Browser-based terminal attachment to a remote session (Marc Nuri-shaped).
- **REMOTE-02**: Multi-user read-only access for Dominic and contractors.
- **REMOTE-03**: Pluggable auth (zero-config personal key vs OIDC).

### Upstream

- **UPSTREAM-01**: Rebase against `simple10/agents-observe` v0.9.5 to pick up the filter-editor rewrite.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Service-worker push notifications | Requires HTTPS and Notification permission flow; deferred to v2 (PUSH-01) |
| Context window % per session | Depends on token-tracking work already in `TASKS.md` FUTURE TASKS; deferred to v2 (OBS-01) |
| Cross-machine remote terminal relay | Expands scope to remote access + auth + a WebSocket terminal protocol the dashboard doesn't have; deferred to v2 (REMOTE-01) |
| Multi-user team read-only access | Single-user assumption simplifies v1; Dominic uses Notion and GitHub for his work today; deferred to v2 (REMOTE-02) |
| Rebase against upstream v0.9.5 | One trivial `session-list.tsx` conflict, separate chore branch after v1 ships; deferred (UPSTREAM-01) |
| Remove `today-summary.sh` and `tab-title.sh` | Kept as fallbacks when localhost is unreachable; demoted from daily use but not deleted |
| Notion data-source API migration | Current bridge stays as is; revisit only if the older endpoint deprecates |
| Switching SQLite driver to `node:sqlite` | Removes a native dep, but better-sqlite3 is integrated and stable; no benefit for the work |

## Traceability

Populated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| HOME-01 | Phase 1a | Pending |
| HOME-02 | Phase 1a | Pending |
| HOME-03 | Phase 1a | Pending |
| HOME-04 | Phase 1a | Pending |
| HOME-05 | Phase 1a | Pending |
| HOME-06 | Phase 1a | Pending |
| HOME-07 | Phase 1a | Pending |
| HOME-08 | Phase 1a | Pending |
| HOME-09 | Phase 1a | Pending |
| HOME-10 | Phase 1a | Pending |
| HOME-11 | Phase 1a | Pending |
| HOME-12 | Phase 1a | Pending |
| HOME-13 | Phase 1a | Pending |
| HOME-14 | Phase 1a | Pending |
| HOME-15 | Phase 1a | Pending |
| TASK-01 | Phase 1b | Pending |
| TASK-02 | Phase 1b | Pending |
| TASK-03 | Phase 1b | Pending |
| TASK-04 | Phase 1b | Pending |
| TASK-05 | Phase 1b | Pending |
| TASK-06 | Phase 1b | Pending |
| TASK-07 | Phase 1b | Pending |
| TASK-08 | Phase 1b | Pending |
| TASK-09 | Phase 1b | Pending |
| TASK-10 | Phase 1b | Pending |
| TASK-11 | Phase 1b | Pending |
| TASK-12 | Phase 1b | Pending |
| TASK-13 | Phase 1b | Pending |
| TASK-14 | Phase 1b | Pending |
| TASK-15 | Phase 1b | Pending |
| TASK-16 | Phase 1b | Pending |
| TASK-17 | Phase 1b | Pending |
| TASK-18 | Phase 1b | Pending |

**Coverage:**
- v1 requirements: 33 total
- Mapped to phases: 33
- Unmapped: 0

---
*Requirements defined: 2026-05-13*
*Last updated: 2026-05-13 after initialization*
