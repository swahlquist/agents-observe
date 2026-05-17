# Phase 1b Context: Tasks Layer + /lingo Writes + Goals Migration + Task Views

**Phase:** 1b
**Name:** Tasks Layer + /lingo Writes + Goals Migration + Task Views
**Mode:** mvp
**Captured:** 2026-05-16
**Discussion mode:** auto (per [[feedback-decision-defaults]] memory: obvious gray areas decided silently, only genuine ambiguity escalated)

<domain>
Promote work units above the session by adding a first-class `tasks` table linked many-to-many to sessions. Migrate existing `projects.goals` JSON rows into the new table without loss. Wire `/lingo` so every invocation creates and links a task to the current session. Ship two new task views (`/tasks` list, `/tasks/:id` detail), make SessionView's Overview tab show real content, and fold in the seven readability/polish items captured during Phase 1a soak.

This phase is what turns agents-observe from a live-session monitor into a work tracker. When Scot looks at the dashboard tomorrow, he can ask "what am I working on for LingoLinq-AAC this week?" and the answer is a real list, not a regex over session prompts.
</domain>

<carry_forward>
Locked in PROJECT.md, REQUIREMENTS.md (TASK-01..TASK-18), and Phase 1a CONTEXT.md. Do not re-decide.

**Schema (TASK-01, TASK-02, TASK-03):**
- `tasks(id uuid PK, title TEXT NOT NULL, description TEXT, status TEXT NOT NULL, source TEXT, external_ref TEXT, project_id INTEGER FK nullable, created_at INTEGER NOT NULL, completed_at INTEGER, metadata TEXT JSON)`
- `session_task_links(session_id, task_id, linked_at, link_source)` composite PK, both FKs ON DELETE CASCADE
- `sessions` gains `category TEXT` and `color TEXT` columns. Additive ALTER. Existing rows backfill `color` from `hash(session_id)`
- All `IF NOT EXISTS` for idempotency

**Migration (TASK-04):**
- One-time idempotent migration creates one task per row in each project's `goals` JSON
- New rows set `source='migrated'`, `project_id` from the project, `status` from goal's `done` flag (`'done'` if true else `'open'`), `metadata.migrated_from_goal_id` = goal id
- Re-running produces zero duplicates (idempotency via `metadata.migrated_from_goal_id` lookup)

**API (TASK-05, TASK-06):**
- `GET /api/tasks` (query: `project_id`, `status`)
- `POST /api/tasks` (create)
- `GET /api/tasks/:id` (returns task + linked sessions with current derived status from Phase 1a)
- `PATCH /api/tasks/:id` (title, status, metadata)
- `POST /api/sessions/:id/link-task` (link existing task)
- `DELETE /api/sessions/:id/link-task/:tid` (unlink)
- WebSocket: every task mutation broadcasts `tasks_update`. Every link mutation broadcasts `task_links_update`. Clients invalidate the relevant TanStack Query cache keys

**/lingo integration (TASK-07, 08, 09, 16, 17, 18):**
- Session resolution order matches `/intent`: `$CLAUDE_SESSION_ID`, then cwd match, then most-recent-active fallback. Resolution failure does NOT block the workflow. Task is created with `project_id=null`
- Bucket to category map: A=understand, B=change-major, C=change-minor, D=infra, E=compliance, F=ship, G=question, H=unsorted
- Bucket-G (pure question) tasks auto-close on the linked session's next `SessionEnd`. Trigger condition: `link_source='lingo'` AND `metadata.bucket='G'` AND most-recent `linked_at` is the only target so we don't close priors
- When resolved session's `intent_source` is `auto` or null, `/lingo` updates the session intent to the new task title. Sticky-manual intents are not overwritten
- `/lingo` also sets `sessions.category` from the bucket map and `sessions.color` if null

**Views (TASK-10, 11, 12, 13):**
- SessionView's Overview tab gets real content (replaces the Phase 1a placeholder)
- `/tasks` list route (filter by project + status, sortable)
- `/tasks/:id` detail route (task metadata + linked sessions block reusing existing `SessionList` component + audit trail)
- `ProjectGoalsPanel` continues to render goals the same way for users but is now backed by the `tasks` table filtered to `project_id = ?` and `source IN ('lingo','manual','migrated')`. No UX regression

**From Phase 1a CONTEXT.md (all still apply):**
- Status states + derivation (used by linked-sessions block in /tasks/:id)
- WebSocket invalidation pattern
- File naming: kebab-case throughout
- All env vars centralized in `hooks/scripts/lib/config.mjs`
- Tests live next to source, Vitest
- No em dashes anywhere in UI strings or test assertions
- Branch from `main`, Conventional Commits
- Performance: O(N) over sessions, O(M) over events. No full event-table scan

</carry_forward>

<canonical_refs>
- `.planning/PROJECT.md` (domain, validated requirements, key decisions)
- `.planning/REQUIREMENTS.md` (TASK-01 through TASK-18 Phase 1b scope, acceptance criteria TASK-14, TASK-15)
- `.planning/ROADMAP.md` (phase goal, success criteria, suggested 4-plan structure)
- `.planning/STATE.md` (Open Items + Phase 1b polish bundle: 7 items + 1 followup bug)
- `.planning/phases/01A-home-view-derived-status/01A-CONTEXT.md` (Phase 1a decisions, status derivation rules, locked conventions)
- `~/ai-company-brain/commands/lingo.md` (canonical `/lingo` source; bucket routing logic to wire task creation into)
- `app/server/src/storage/sqlite-adapter.ts` (schema migrations live here; new tables and ALTERs land alongside existing patterns)
- `app/server/src/routes/sessions.ts` (`rowToRecentSession`, `deriveSessionStatus` from Phase 1a; link-task endpoints mount here)
- `app/server/src/lib/derive-status.ts` (Phase 1a derivation helper; linked-sessions in /tasks/:id pulls from this)
- `app/client/src/components/main-panel/project-goals-panel.tsx` (rewire target for TASK-13)
- `app/client/src/components/main-panel/project-page.tsx` (host of ProjectGoalsPanel)
- `app/client/src/components/sidebar/session-list.tsx` (reuse target for linked-sessions block in /tasks/:id per TASK-12)
- `app/client/src/hooks/use-recent-sessions.ts` (extend, do not fork; new task queries follow same TanStack Query + WS-invalidation shape)
- `app/client/src/stores/ui-store.ts` (`bellEnabled`, `selectedProjectId`, `selectedSessionId` patterns to clone for task selection)
- `app/client/src/components/sidebar/project-list.tsx` (host of the gemini-X/X collapse work and Unassigned bucket cleanup)
- `app/client/src/hooks/use-pulse-active.ts` (location of the stale-green-dot bug, 1a followup)
- `app/client/src/components/main-panel/session-card.tsx` (host of the `>_` prefix removal, color chip replacement, font/padding bump)
</canonical_refs>

<decisions>

### Task lifecycle and status transitions (DECIDED)

- New `/lingo` tasks start with `status='open'`
- Bucket-G auto-closes to `status='done'` on linked session's next `SessionEnd` (per ROADMAP)
- All other buckets stay `open` until manually closed via `PATCH /api/tasks/:id`
- Manual reopen is allowed (PATCH `status` back to `open`); audit trail captures the transition
- Status enum is fixed at `'open' | 'done' | 'abandoned'`. `abandoned` is reserved for manual use ("I gave up on this") and does not auto-trigger
- `completed_at` is set on the transition to `done`. Cleared if reopened

**Why:** Matches the existing `goals.done` boolean semantics so the migration is a clean lift. Keeps lifecycle small enough that Scot doesn't have to learn a workflow. Reserves `abandoned` for the explicit "I'm not doing this anymore" case so it doesn't get confused with `ABANDONED` session status.

### Task title from /lingo prompt (DECIDED)

`derive_label(prompt)` algorithm:

1. Strip leading slash-command tokens with regex `^/\w+\s+` (removes `/lingo `, `/lingo-fast `, etc), case-insensitive
2. Strip leading/trailing whitespace
3. Take the first sentence by splitting on `[.!?]\s` and taking element 0
4. If first sentence is empty or longer than 80 chars, fall back to first line (split on `\n`, take element 0)
5. Truncate to 60 characters using single-character ellipsis (`…` U+2026), same convention as `lastActionLabel`
6. If result is empty, fallback to `"Untitled task"`

**Why:** Matches Linear/Notion/Trello convention (first sentence as title, longer body as description). 60 chars is the standard scannable-list cap. Single-character ellipsis matches Phase 1a's explicit choice of `…` over `...`.

**Description field:** first 200 chars of the original prompt (after slash-command strip), unchanged from REQUIREMENTS.md TASK-07.

### /tasks list view layout (DECIDED)

**Row list, not kanban, not table.** Layout per row:
- Color chip (24px, left edge) colored by `tasks.color` (inherited from linked session) or grey if unlinked
- Title (16px, primary)
- Status pill (green=open, blue=done, grey=abandoned)
- Category icon (lucide-react, matches Phase 1a bucket-to-icon map)
- Project badge (small pill with project name + color)
- "N sessions" link (e.g. "3 sessions", click to jump to detail)
- Relative time (lastActivity if linked sessions exist, else `created_at`)

**Filters bar** (sticky at top):
- Project (dropdown, default "All projects")
- Status (chips: Open / Done / Abandoned, default "Open" only)
- Sort dropdown: Recent activity / Created / Completed

**Sections** (always shown when filter = Open):
- Needs You: tasks whose linked sessions have `needsYou=true` (top, mirrors home view pattern)
- By project: open tasks grouped by project name, collapsible
- No empty-state grouping spam. Collapse empty groups entirely

**Why:** Row list reads fastest at scale (Scot will have 40+ open tasks within weeks). Kanban-by-status was rejected because the open-to-done flow is mostly linear with no in-progress / review states. Kanban columns would just be "open" and "done" which is a list with extra steps. Mirrors the home view "Needs You + grouped by project" pattern from Phase 1a so the muscle memory transfers.

### /tasks/:id detail view layout (DECIDED)

**Single scrollable page**, not tabs. Sections top to bottom:

1. **Header**: title (inline-editable, click to edit), status pill (click to toggle), category icon, project badge, color chip
2. **Description** (collapsible if longer than 3 lines)
3. **Metadata strip** (4-column): Created `<date>` / Last activity `<relative>` / Source `<lingo|manual|migrated>` / `<N>` linked sessions
4. **Linked Sessions**: reuses `SessionList` component verbatim. Each row shows current derived status from Phase 1a. Each row has an "Unlink" affordance on hover (calls DELETE endpoint)
5. **Audit Trail**: most recent first, collapsed to last 5 by default. Format: `<actor> / <transition> / <relative time>` (e.g. `system / auto-closed on SessionEnd / 2h ago`)

**Why:** Linear-style single scroll beats tabs for this much info. Scot can ctrl-F. Tabs hide context. The detail page is rarely visited (you live in the list), so optimizing for first-time scan beats power-user navigation.

### SessionView Overview tab content (DECIDED)

Replace Phase 1a's `"Tasks: arriving in Phase 1b"` placeholder with this layout, top to bottom:

1. **Linked Tasks** (dominant block): list of tasks linked to this session, each with title, status pill, "Unlink" hover action. If none: `"No tasks yet. Run /lingo in this session to start one."`
2. **Intent + Category + Color** (single row, inline-editable): intent text input, category dropdown (8 options matching bucket map), color picker (8-color palette from Phase 1a)
3. **Last 5 actions** (compact card): derived from session events, reuses Phase 1a's `lastActionLabel` format
4. **Project goal progress** (small card, only shown if session has a `project_id` and that project has open tasks): `<X> of <Y> tasks open, <Z>% done`
5. **Dismiss notification button**: only shown when `needsYou=true`. Clicking calls existing `clearSessionNotification`

**Why:** Linked Tasks is the new feature, so it's dominant. Intent/category/color were already in REQUIREMENTS.md as edit affordances. Clustering them into one inline-editable row is denser than a settings panel. Last 5 actions is reference info, not interactive, so it goes mid-page. Project goal progress is small contextual help, only shown when relevant. Dismiss is the action that flips needsYou off, so it lives where the user looks when reacting to a bell.

### Goals to tasks migration: keep or drop the `projects.goals` column (DECIDED)

**Keep `projects.goals` as a denormalized cache for one release.** Drop in a separate followup chore after 1b ships and a week of stability.

- The migration writes to `tasks` and leaves `projects.goals` untouched
- `ProjectGoalsPanel` reads from `tasks` (per TASK-13)
- New goal mutations from the panel write to `tasks` only. Do NOT dual-write to `projects.goals`. No sync code to maintain
- A separate "drop column" plan ships about 7 days post-1b, only after Scot confirms no regressions

**Why:** The cost of keeping the column is tiny (one unused TEXT column per project, there are fewer than 30 projects). The cost of dropping it the same release is real. If anything in the migration silently lost a goal, the data is gone forever. The conservative play costs about 5 minutes of disk vs catastrophic data loss risk.

### Polish bundle scope (DECIDED, all 7 items ship in 1b)

All seven readability/polish items from STATE.md ship in Phase 1b, bundled into a single "polish + bugfix" plan separate from the tasks-layer plans:

1. Drop `>_` row prefix on session cards (trivial CSS/JSX)
2. Replace 2px color stripe with 16-24px visible color chip
3. Hide or rename git-hash placeholders in Unassigned sidebar
4. Terminal-tab correlation: chip + 2-letter or emoji session label on each card
5. Bump base font 2-3pt and increase card padding
6. Collapse `gemini-X` and `X` into single `X` project folder with per-session client badge (small "C" / "G" pill)
7. Fix stale green pulse dot when SessionEnd is missed (the stripe-rotation-runbook case)

Estimated polish plan cost: 2-3 days. Total 1b cost projected at 8-10 days.

**Why bundle in 1b vs separate phase:** All seven items touch components that 1b is already modifying (sidebar, session-card, project-list). Splitting would mean two phases editing the same files in sequence, duplicating context-loading cost. Keeps the discuss-plan-execute loop short.

**Why a separate plan within 1b vs scattered:** Atomic commits stay clean, and if any single polish item turns into a rabbit hole it can be punted without blocking the tasks-layer work.

### WebSocket envelope shape (DECIDED)

`tasks_update` and `task_links_update` broadcast contents:
- `tasks_update`: `{ taskId, op: 'create' | 'update' | 'delete', task: {...full row} }`
- `task_links_update`: `{ sessionId, taskId, op: 'link' | 'unlink', linkSource? }`

Cache keys to invalidate on `tasks_update`:
- `['tasks']` (list view)
- `['tasks', taskId]` (detail view)
- `['project-tasks', projectId]` (ProjectGoalsPanel)
- `['session-tasks', sessionId]` (SessionView Overview), for each session in `task.linkedSessionIds`

Cache keys to invalidate on `task_links_update`:
- `['session-tasks', sessionId]`
- `['tasks', taskId]`
- `['recent-sessions']` (in case the linked-task affects display)

**Why:** Mirrors Phase 1a's WS invalidation pattern verbatim. Keeping the envelope shape symmetric ("op" verb + payload) lets the client use one switch handler.

### Audit trail storage (DECIDED)

Add a `task_audit` table:
- `task_id` FK
- `actor` TEXT (`'system'` or `'user'` for now; future-proofs for multi-user)
- `event` TEXT (`'created' | 'status_changed' | 'reopened' | 'auto_closed' | 'linked' | 'unlinked' | 'renamed'`)
- `from_value` TEXT nullable
- `to_value` TEXT nullable
- `at` INTEGER NOT NULL

Renders into TASK-12's audit trail section. Append-only. Never updated or deleted by application code.

**Why:** TASK-12 specifies "audit trail" but doesn't define the storage. A flat append-only table is the smallest thing that works. Reusing `metadata` JSON on tasks would make the rendering O(N) per task. A separate indexed table is cheaper.

</decisions>

<deferred_ideas>
Captured during 1b scoping, not in scope for 1b:

- **Notion daily-task-chart sync**: Scot's stated end-state. The `tasks.external_ref` field is reserved for the Notion page ID and `source='notion'` reserves the source column slot. Actual sync wiring is a v2 phase candidate (NOTION-01). Already logged in STATE.md.
- **Multi-actor audit trail**: `task_audit.actor` is shaped for multi-user but only `'system'` and `'user'` are used in 1b. Real user identity belongs with REMOTE-02.
- **Bulk task operations**: multi-select in /tasks list, bulk close/reopen/move-to-project. Defer until volume hurts.
- **Task tags / labels**: orthogonal to category. The existing Labels system (`Label`/`LabelList` already in the codebase, currently session-scoped) might extend to tasks later. Out of scope.
- **Task templates**: pre-fill /lingo bucket and category from a saved template. Defer until pattern is clear.
- **Drop `projects.goals` column**: separate followup plan after 1b ships + 1 week soak.
- **Auto-set Windows Terminal tab color via OSC escape codes on session start**: v2 candidate, logged in STATE.md polish notes.
- **In-app remote terminal attachment to a session**: REMOTE-01, already in v2 requirements.
- **Service-worker push when needsYou flips**: PUSH-01, already in v2 requirements.
</deferred_ideas>

<code_context>

### Reusable assets

- `app/client/src/components/sidebar/session-list.tsx`: REUSE verbatim for `/tasks/:id` linked-sessions block (per TASK-12)
- `app/client/src/components/main-panel/project-goals-panel.tsx`: rewire backing data source (per TASK-13), keep the rendering identical
- `app/server/src/lib/derive-status.ts`: Phase 1a's status helper. The linked-sessions block in `/tasks/:id` pulls derived status from this
- `app/server/src/storage/sqlite-adapter.ts`: schema migration pattern + transaction helpers
- `app/server/src/routes/sessions.ts`: `rowToRecentSession` + `deriveSessionStatus` continue to feed the linked-sessions block
- `app/client/src/hooks/use-recent-sessions.ts`: TanStack Query + WS invalidation pattern to clone for `use-tasks` and `use-task`
- `app/client/src/stores/ui-store.ts`: `selectedSessionId`, `selectedProjectId` patterns to clone for `selectedTaskId`
- `lucide-react` icons for category icons (already used by session card per Phase 1a)
- Phase 1a's bucket-to-icon map in `session-card.tsx` (Wrench/Sparkles/BookOpen/Rocket/Brush/FlaskConical/Terminal): reuse for task category icons

### /lingo integration touchpoints

- Source: `~/ai-company-brain/commands/lingo.md` (slash-command markdown)
- The bucket routing logic already exists for routing the workflow. Task creation slots in between bucket classification (already done) and workflow execution
- `$CLAUDE_SESSION_ID` env var is set by Claude Code in every session. `/lingo` already reads it for `/intent` resolution
- Most-recent-active fallback already exists in `/intent`. Extract into a shared helper if not already

### Patterns to follow

- Schema migrations: additive `ALTER TABLE` + `IF NOT EXISTS`, run on server start. Verify against `app/server/src/storage/sqlite-adapter.ts`'s existing pattern
- Server route handlers: thin wrappers over `storage` methods. Validation lives in route, business logic in storage
- Tests live next to source (`*.test.ts(x)`). Use Vitest. Integration tests for migration idempotency (run twice, assert zero new rows)
- Client mutations: TanStack Query `useMutation` with `onSuccess` invalidating relevant query keys
- File naming: kebab-case throughout (`use-tasks.ts`, `use-task.ts`, `task-card.tsx`, `tasks-page.tsx`, `task-detail-page.tsx`)
- Conventional Commits per agents-observe convention. No `feat:` for tests (use `test:`)

### Integration points

**Server:**
- `app/server/src/storage/sqlite-adapter.ts`: new tables, new ALTERs, migration helper
- `app/server/src/routes/tasks.ts` (new): task CRUD + link/unlink routes
- `app/server/src/lib/derive-label.ts` (new): the title derivation helper from `/lingo` prompt
- `app/server/src/services/migration.ts` (or wherever migrations live): goals to tasks one-time migration with idempotency
- `app/server/src/ws/broadcast.ts` (or equivalent): add `tasks_update`, `task_links_update` envelope handlers

**Client:**
- `app/client/src/hooks/use-tasks.ts` (new): list query
- `app/client/src/hooks/use-task.ts` (new): detail query
- `app/client/src/components/main-panel/tasks-page.tsx` (new): `/tasks` list view
- `app/client/src/components/main-panel/task-detail-page.tsx` (new): `/tasks/:id` detail view
- `app/client/src/components/main-panel/session-view/overview-tab.tsx` (new or rewrite of placeholder)
- `app/client/src/components/main-panel/project-goals-panel.tsx`: rewire to tasks API
- `app/client/src/components/sidebar/project-list.tsx`: gemini-X collapse + Unassigned bucket cleanup
- `app/client/src/components/main-panel/session-card.tsx`: polish bundle (>_ removal, color chip, font, terminal-tab label)
- `app/client/src/hooks/use-pulse-active.ts`: stale green dot fix
- `app/client/src/router.ts` (or wherever routes are registered): add `/tasks` and `/tasks/:id`

**/lingo skill:**
- `~/ai-company-brain/commands/lingo.md`: add the task-creation step after bucket classification and the session-link step after task creation

### Things to leave alone

- `pending_notification_ts` and the existing notification flow (Phase 1a is the source of truth here)
- The Phase 1a derived status fields and `lastActionLabel` (just consume them in the linked-sessions block)
- `SessionList`'s internal rendering (reuse, don't fork)
- `ExternalTasksPanel` and the Notion bridge (the Notion sync work is deferred to v2, do not entangle here)
- The WebSocket transport layer itself; piggyback on existing envelope conventions
- The `projects.goals` column write path is being deprecated but the column itself stays for one release

</code_context>

<acceptance_for_phase>
From REQUIREMENTS.md TASK-14, TASK-15 + Phase 1a parity:

1. Scot can pull up `/tasks`, filter to open tasks for one project, and see every `/lingo`-created task he has launched, sorted by recent activity.
2. Clicking a task in `/tasks/:id` shows every session that has worked on it with each session's current derived status (WORKING/IDLE/etc per Phase 1a).
3. The bucket-G auto-close rule fires on the linked session's `SessionEnd` event. A follow-up `/lingo` for a closed question does NOT reopen the prior task.
4. Re-running the goals migration produces zero new rows (idempotency).
5. `ProjectGoalsPanel` renders the same as before the migration for the user. Writes go through the `tasks` table.
6. All 7 polish items from STATE.md are visible in the dashboard: no `>_` prefix, color chips visible at 16-24px, no git-hash names in Unassigned, terminal-tab correlation works, font/padding bumped, gemini-X and X folders collapsed with client badges, no stale green dots on dead sessions.
7. `just check` passes. No em dashes anywhere in UI strings or new test assertions.
</acceptance_for_phase>

<next_steps>
- `/clear` to free context, then `/gsd-plan-phase 1b` to generate the implementation plan.
- After plan exists, run `/adversary-review` on it (CLAUDE.md hard rule). Block on Critical/High findings, list Medium/Low separately.
- Then `/gsd-execute-phase 1b`.
- Suggested plan structure (4 plans, mostly parallel after Plan 1):
  - Plan 01B-01: Schema + migration + idempotency tests (server-only, blocks others)
  - Plan 01B-02: Tasks API + WS broadcasts + ProjectGoalsPanel rewire (server + small client)
  - Plan 01B-03: /lingo skill changes + bucket-G auto-close hook (touches `~/ai-company-brain/commands/lingo.md` and the server's SessionEnd handler)
  - Plan 01B-04: Task views + SessionView Overview + polish bundle (client-only)
</next_steps>

---
*Phase 1b context captured 2026-05-16 in auto-decide mode per [[feedback-decision-defaults]]. Genuine ambiguity escalation skipped because none surfaced. All gray areas had clear answers from priors and conventions. Scot can redirect any decision by replying with "change X to Y".*
</content>
