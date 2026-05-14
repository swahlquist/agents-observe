# Agents Observe — Founder-Mode Home View + Task/Session Tracking (v1)

## What This Is

agents-observe is a real-time observability dashboard for Claude Code and Gemini CLI sessions, forked from `simple10/agents-observe` and run as a systemd user service on WSL2. This project is a v1 redesign that turns the existing developer-flavored home view into a glance-readable founder-mode dashboard, and adds a first-class task model that links cross-session work units to the slash command (`/lingo`) that creates them. Sole user is the CEO of LingoLinq (Scot Wahlquist), who runs four to five concurrent sessions across LingoLinq backend, ai-company-brain automation, and infrastructure work.

## Core Value

Open the dashboard, see at a glance which sessions need me, what each one is doing right now, and which work units span multiple sessions, without reading any code or event logs.

## Requirements

### Validated

<!-- Shipped before this project began. Live in main. -->

- ✓ Session intent (`/intent` + sticky-manual + auto-derive from first prompt) — pre-existing in main
- ✓ Overlap detection (file-touch banner when two sessions edit the same file) — pre-existing in main
- ✓ Project goals JSON panel (auto-link to session intents) — pre-existing in main
- ✓ Outgoing webhook (POST on `session_start` / `session_stop` / `notification`) — pre-existing in main
- ✓ Incoming Notion bridge (`GET /api/external-tasks`, "Today" panel, hides when unconfigured) — pre-existing in main
- ✓ Gemini CLI sessions wired via `~/.gemini/settings.json` → `dashboard/bridge/gemini-hook.sh` — pre-existing
- ✓ Dashboard auto-starts at WSL boot via `~/.config/systemd/user/agents-observe.service` — pre-existing

### Active

<!-- v1 hypotheses, building toward these. -->

#### Phase 1a — Home view UI + derived status (no schema migration)

- [ ] **HOME-01**: Server derives `status`, `statusDetail`, `needsYou`, `lastActionLabel`, `lastActionAt` per session at query time and includes them on `GET /sessions/recent` and `GET /sessions/:id`
- [ ] **HOME-02**: Derivation correctly maps unhandled `Notification` events to `WAITING_ON_PERMISSION` (with parsed tool name) or `WAITING_FOR_INPUT`, using real journal message strings
- [ ] **HOME-03**: Home view shows a "Needs You" pile at the top, populated from sessions where `needsYou=true`, sorted by most-recent notification
- [ ] **HOME-04**: Home view groups remaining sessions by project, collapsible per group, with active count and finished-today count in the header
- [ ] **HOME-05**: Each session row renders as a card with status badge, category icon (derived client-side in 1a), color stripe (derived from session_id hash), intent label, client badge (claude vs gemini), `lastActionLabel`, and relative time
- [ ] **HOME-06**: A "Finished today" section appears below project groups, collapsed by default
- [ ] **HOME-07**: The Notion "Today" panel moves to the bottom of the home view; still hides when env unset
- [ ] **HOME-08**: When `needsYou` flips from false to true on any visible session, the browser tab title updates to `(N) <top session intent> · agents-observe` (unconditional)
- [ ] **HOME-09**: When `needsYou` flips from false to true, an audible bell plays a short single tone, mutable via a UI store toggle (default on)
- [ ] **HOME-10**: SessionView's existing event timeline is reachable behind an "Activity" tab label; the default tab is "Overview" (placeholder content in 1a, real content in 1b)
- [ ] **HOME-11**: `/today` script output and the new home view agree on which sessions are active and which need attention (visual parity test, manual acceptance)

#### Phase 1b — Tasks layer, `/lingo` writes, goals migration, task views

- [ ] **TASK-01**: New `tasks` table (id uuid, title, description, status, source, external_ref, project_id FK nullable, created_at, completed_at, metadata JSON)
- [ ] **TASK-02**: New `session_task_links` table (session_id, task_id, linked_at, link_source; composite PK)
- [ ] **TASK-03**: `sessions` table gains `category` (enum) and `color` columns, additive migration
- [ ] **TASK-04**: One-time idempotent migration moves rows from `projects.goals` JSON into `tasks` with `source='migrated'`; sticky on `metadata.migrated_from_goal_id`
- [ ] **TASK-05**: New routes `/api/tasks` (GET filter, POST create), `/api/tasks/:id` (GET with linked sessions, PATCH), `/api/sessions/:id/link-task` (POST), DELETE link
- [ ] **TASK-06**: WebSocket broadcasts `tasks_update` and `task_links_update` on every mutation
- [ ] **TASK-07**: `/lingo` skill writes a task and links it to the current session on every invocation, mapping the chosen bucket to a `category` value
- [ ] **TASK-08**: `/lingo` resolves the current session via `$CLAUDE_SESSION_ID` → cwd match → most-recent-active fallback (same order as `/intent`)
- [ ] **TASK-09**: Bucket G (pure question) tasks auto-close on `SessionEnd`
- [ ] **TASK-10**: SessionView's "Overview" tab gains real content: linked tasks list, intent edit, category, color, project goal progress, last-five-actions summary, needs-you dismiss
- [ ] **TASK-11**: New `/tasks` list view (filter by project + status, sortable by created/completed)
- [ ] **TASK-12**: New `/tasks/:id` detail view showing task metadata + linked sessions block (reusing `SessionList`) + audit trail
- [ ] **TASK-13**: `ProjectGoalsPanel` continues to render the same way for users but is now backed by the `tasks` table (no UX regression)

### Out of Scope

<!-- Explicit exclusions for v1. Deferred or rejected. -->

- Service-worker push notifications when `needsYou` flips — Phase 2; needs HTTPS + permissions handling that browser tab title and audible bell sidestep for v1
- Context window % per session — depends on token-tracking work already listed in TASKS.md FUTURE TASKS; out of scope until that lands
- Cross-machine remote terminal relay — Marc Nuri-shaped but expands scope to remote access, auth, and a WebSocket terminal protocol that the dashboard doesn't have
- Multi-user / team read-only access for Dominic and contractors — adds auth scope (none exists today); single-user assumption simplifies v1
- Rebase against `upstream/main` (`simple10/agents-observe` v0.9.5 filter-editor changes) — separate chore branch; one trivial `session-list.tsx` conflict only, not blocking
- Removing `~/ai-company-brain/scripts/today-summary.sh` and `hooks/tab-title.sh` — kept as out-of-band fallbacks when localhost is unreachable; demoted from daily use but not deleted
- Notion data-source API migration — current bridge stays as is; revisit in Phase 2 if the older API endpoint deprecates

## Context

- Repo: `~/ai-company-brain/dashboard/agents-observe`, branch `main`, 8 commits ahead of `origin/main` (rewritten history of same content). Origin push deferred until force-push-with-lease is approved.
- Stack: Node 20, TypeScript 5.7, React 19, TanStack Query 5, better-sqlite3 12.8, Vitest 3.
- Build commands: `just dev` (hot reload, ports 4981 and 5174), `just check` before every commit, `just start-local` if vite dies.
- All env vars centralized in `hooks/scripts/lib/config.mjs`. Never read `process.env` elsewhere.
- File naming: kebab-case throughout.
- Commit convention: Conventional Commits (see repo `CLAUDE.md`).
- Event taxonomy is stable across both clients (claude, gemini): `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `Stop`, `SubagentStop`, `BeforeAgent`, `AfterAgent`, `Notification`, plus `BeforeTool` and `AfterTool` for tool calls.
- Notification message strings used by the status derivation are quoted directly from the journal, not invented. Examples: "Claude is waiting for your input", "Claude needs your permission to use Bash", "Claude Code needs your attention".
- Dashboard auto-starts as a systemd user service; the WSL2 `[boot] command =` option in the earlier handoff doc is moot and superseded.

## Constraints

- **Tech stack**: Pinned to better-sqlite3 (do not switch to `node:sqlite`), React 19 (use existing patterns, don't introduce server components), TanStack Query 5 (no new fetchers; reuse hook style).
- **Compliance**: None for this project — local-only dashboard with no LingoLinq customer data. FERPA / HIPAA / GDPR do not apply.
- **No em dashes**: User-facing text (UI strings, commit messages, release notes) must not contain em dashes. Code, JSON, and log examples are exempt.
- **Branch from main**: This repo has no staging branch. Conventional Commits enforced.
- **Hooks**: Pre-commit `just check` must pass (tests + format). Never bypass with `--no-verify`.
- **Performance**: Status derivation runs on every `/sessions/recent` call. Must be O(N) over sessions and O(M) over last-N events per session, with N capped at 30 and M capped at last 50 events. No full event-table scan.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Split v1 into Phase 1a (UI + derived status) and Phase 1b (tasks layer + /lingo writes) | Smaller PR blast radius; validate UX before committing to the data model; tasks migration is the one irreversible change and benefits from focused review | — Pending |
| Migrate `projects.goals` JSON into the new `tasks` table | Single source of truth; goals are tasks with a project filter; loses no information; one-time idempotent migration | — Pending |
| Derive `status` and `needsYou` at query time, do not store | Avoids update-on-every-event races; cheap to recompute on a 30-session window; status is a view, not a fact | — Pending |
| Bell + tab title for v1, defer service-worker push to Phase 2 | Tab title is free (data already in store); bell is one new audio asset and a UI toggle; service-worker push requires HTTPS and permissions handling that adds scope | — Pending |
| Audible bell defaults to ON, configurable via UI store toggle | Founder needs the audio signal more than the silence; trivial to disable for video calls | — Pending |
| Vercel-style row list with Linear-style "needs you" pile, grouped by project | Closest match to the actual job (watch parallel processes, see what needs me, drop into one); rejected Marc Nuri (dense, dev-flavored), Notion cards (too sparse), pure Linear (sessions aren't binary triage items) | — Pending |
| Use existing systemd user service, ignore `[boot] command =` route in handoff | Already deployed and working 3+ days; survives `wsl --shutdown` because WSL boots with `systemd=true` | — Validated |
| Do not rebase against `upstream/main` v0.9.5 inside this project | One trivial `session-list.tsx` conflict; rebasing here would mix scope; separate chore branch after v1 ships | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-13 after initialization*
