# Roadmap: Founder-Mode Home View + Task/Session Tracking (v1)

**Created:** 2026-05-13
**Mode:** MVP (vertical slices, ship-then-validate)
**Phases:** 2
**Requirements mapped:** 33 of 33 (100%)
**Granularity:** Coarse
**Execution:** Sequential (Phase 1b depends on Phase 1a)

## Overview

| # | Phase | Goal | Requirements | Success Criteria |
|---|-------|------|--------------|------------------|
| 1a | Home View + Derived Status | Make the home view glance-readable for a non-dev CEO running 4-5 parallel sessions, without any schema changes | HOME-01 through HOME-15 (15) | 5 criteria |
| 1b | Tasks Layer + /lingo Writes + Goals Migration + Task Views | Add a first-class task model linked to sessions, with `/lingo` as the primary task creator and a cross-project task list view | TASK-01 through TASK-18 (18) | 5 criteria |

## Phase 1a: Home View + Derived Status

**Goal:** Replace the current developer-flavored row list with a founder-mode home view that surfaces "needs you" sessions, groups remaining sessions by project, shows human-readable status per card, and writes the browser tab title plus an audible bell when a session needs the user. No schema migration. All new state derived at server query time from existing tables.

**Mode:** mvp

**Requirements covered:**
- HOME-01 (status fields on session responses)
- HOME-02 (notification message parsing)
- HOME-03 (Needs You pile at top)
- HOME-04 (project groups, collapsible)
- HOME-05 (session card layout)
- HOME-06 (Finished today section)
- HOME-07 (Notion Today panel moved to bottom)
- HOME-08 (document.title write)
- HOME-09 (audible bell with mute toggle)
- HOME-10 (SessionView Overview/Activity tabs)
- HOME-11 (recency classification rules)
- HOME-12 (O(N) derivation perf)
- HOME-13 (status badge colors)
- HOME-14 (glance-readable acceptance)
- HOME-15 (parity with /today)

**Success Criteria:**
1. Opening `localhost:4981` shows Needs You pile (or empty state), grouped projects with collapsible sections, and Finished today section, in the order specified.
2. Every visible session card renders status badge, category icon, color stripe, intent, client badge, lastActionLabel, and time without overflow.
3. When a session emits a Notification, the browser tab title updates within 1 second and the audible bell plays once (when unmuted).
4. Server `GET /sessions/recent` returns the five new derived fields. Existing fields unchanged. Tests cover all status branches using real journal notification strings.
5. `/today` script and the new home view agree on which sessions are active and which need attention (visual parity, manually verified).

**Out of scope for this phase:**
- Tasks table, `/lingo` writes, task views (Phase 1b).
- Service-worker push, context %, remote terminal (deferred to v2).

**Suggested plan structure:**
- Plan 1: Server status derivation + tests (3 days). Pure backend change on existing routes. New unit tests using captured journal messages.
- Plan 2: Client redesign and side effects (3-4 days). New components (`needs-you-pile`, `project-group`, `session-card`, `finished-today`), HomePage rewrite, document.title hook, audible bell hook with UI store toggle, SessionView Overview/Activity tab rename.

**Risks / pitfalls:**
- The `lastActionLabel` derivation needs to handle tool_use_id and the BeforeTool/AfterTool pairing. If event payload schema has drifted, derivation will silently default to null. Mitigation: write tests against the real events table on first server start before deploying.
- React 19 + TanStack Query 5: the existing hooks pattern uses `useQuery` with WebSocket invalidation. The new derived fields land in the same payload, so cache shape is backwards-compatible; do not split into a second query.
- Audible bell on every notification can become annoying. Default-on is required for value, but the UI toggle must persist via `useUIStore` (zustand), not local state.

## Phase 1b: Tasks Layer + /lingo Writes + Goals Migration + Task Views

**Goal:** Promote work units above session by adding a `tasks` table, link them many-to-many to sessions, migrate the existing `project_goals` JSON into the new table, wire `/lingo` to create a task and link it to the current session on every invocation, and surface tasks in two new views (`/tasks` list and `/tasks/:id` detail) plus a real SessionView Overview tab.

**Mode:** mvp

**Requirements covered:**
- TASK-01 through TASK-13, TASK-16 through TASK-18 (schema, API, /lingo integration, ProjectGoalsPanel backing)
- TASK-09 (bucket-G auto-close)
- TASK-10 (SessionView Overview real content)
- TASK-11 (/tasks list view)
- TASK-12 (/tasks/:id detail view)
- TASK-14 (cross-project task list acceptance)
- TASK-15 (linked-sessions acceptance, bucket-G auto-close acceptance)

**Success Criteria:**
1. Migration creates `tasks` and `session_task_links` tables, adds `category` and `color` to `sessions`, and moves existing `projects.goals` rows into `tasks` without loss. Re-running the migration produces zero new rows.
2. `/lingo` creates a task on every invocation (verified by manual `/lingo` run + reading `/api/tasks` response).
3. `ProjectGoalsPanel` renders the same as before for the user, but writes go through the new `tasks` table (verified by checking row presence in `tasks` vs absence in `projects.goals` after first edit).
4. `/tasks` route lists all tasks filterable by project and status. `/tasks/:id` shows the task with all linked sessions, each with current derived status.
5. Bucket-G (pure question) tasks transition to `done` on the linked session's `SessionEnd` and stay closed across follow-up `/lingo` calls.

**Out of scope for this phase:**
- Multi-user / team access (v2 REMOTE-02).
- Service-worker push notifications (v2 PUSH-01).
- Context % per session (v2 OBS-01).

**Suggested plan structure:**
- Plan 1: Schema migration + goals → tasks backfill + idempotency tests (2 days). All server-side.
- Plan 2: Tasks API + WebSocket broadcasts + `ProjectGoalsPanel` rewire (2 days).
- Plan 3: `/lingo` skill changes + bucket → category map + auto-close hook for bucket G (2 days). Touches `~/ai-company-brain/commands/lingo` and `observe_cli.mjs`.
- Plan 4: Tasks views (`/tasks`, `/tasks/:id`) + SessionView Overview real content (2-3 days).

**Risks / pitfalls:**
- Goals → tasks migration is the one irreversible change. Mitigation: idempotency check via `metadata.migrated_from_goal_id`; keep `projects.goals` column for one release as a denormalized cache before dropping. Roll-forward only.
- `/lingo` writing to the API requires the dashboard server to be reachable. If it's not (WSL not running), `/lingo` should not block; fail open and skip the task write with a warning log.
- Bucket G auto-close on SessionEnd: if a user reuses the same session for multiple `/lingo G` calls, only the most recent task should auto-close. Otherwise we close prior tasks too. Mitigation: link `link_source='lingo'` plus `metadata.bucket='G'` plus the most-recent `linked_at` is the only target.

## Sequencing

```
Phase 1a (ship + live for 24h+)  ->  Phase 1b
```

Phase 1b explicitly requires Phase 1a to have shipped and been used for at least 24 hours before starting. Rationale: the home view's new derived state must prove stable under real session load before we commit to the task data model that mirrors it.

## Out of Roadmap

The following are explicitly deferred. Each is on the v2 list in `REQUIREMENTS.md`.

- PUSH-01, PUSH-02 (service-worker push)
- OBS-01, OBS-02 (context window % + token roll-up)
- REMOTE-01, REMOTE-02, REMOTE-03 (remote terminal, multi-user, pluggable auth)
- UPSTREAM-01 (rebase against upstream v0.9.5)

## Hard Rules

- No em dashes in any user-facing text (UI strings, commit messages, release notes, docs).
- Branch from `main`; this repo has no staging branch.
- Conventional Commits for every commit.
- `just check` must pass before commit. No `--no-verify`.
- `/adversary-review` runs on every phase plan before `/gsd-execute-phase`. Critical or High findings block execute; Medium goes to user for triage; Low is logged.
- All env vars centralized in `hooks/scripts/lib/config.mjs`.
- File names kebab-case.

---
*Roadmap created: 2026-05-13*
*Last updated: 2026-05-13 after initialization*
