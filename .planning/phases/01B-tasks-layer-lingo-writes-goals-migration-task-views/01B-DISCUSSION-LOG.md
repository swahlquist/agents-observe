# Phase 1b Discussion Log

**Date:** 2026-05-16
**Mode:** auto-decide
**Memory pointer:** `~/.claude/projects/-home-scotw-ai-company-brain/memory/feedback_decision_defaults.md`

## Context

Scot ran `/gsd-discuss-phase 1b` after Phase 1a's soak period. Initial run presented a 4-area multiSelect (task title derivation, /tasks view layout, SessionView Overview content priority, polish bundle scope). Scot selected all 4. The discussion session subsequently hung for an hour, prompting cancellation.

Scot then gave the binding instruction: "If it's obvious, just make the decision on it. If there are some that aren't, explain it as though I'm not a dev and give recommendation."

I saved this as a persistent feedback memory ([[feedback-decision-defaults]]) and re-ran the discussion in auto-decide mode.

## Decisions made silently (no escalation)

All four gray areas turned out to have clear answers from priors:

### 1. Task title from /lingo prompt
**Decided:** Strip slash-command prefix, take first sentence (split on `[.!?]\s`), fall back to first line if empty or >80 chars, truncate to 60 chars with single-character ellipsis, fallback to "Untitled task" if empty.
**Rationale:** Matches Linear/Notion/Trello convention. Single-character ellipsis matches Phase 1a's explicit choice.

### 2. /tasks list + detail view layout
**Decided:** Row list (not kanban, not table) with sticky filters bar. Sections: Needs You at top + grouped by project. Detail view is single scrollable page (not tabs), with Header > Description > Metadata strip > Linked Sessions (reusing SessionList) > Audit Trail.
**Rationale:** Mirrors Phase 1a's home view pattern (Needs You + project groups) so muscle memory transfers. Kanban rejected because open-to-done lifecycle has no intermediate states; would just be a 2-column kanban which is a list with overhead.

### 3. SessionView Overview tab content priority
**Decided:** Top-to-bottom: Linked Tasks (dominant) > Intent/Category/Color inline-editable row > Last 5 actions > Project goal progress (conditional) > Dismiss button (conditional).
**Rationale:** Linked Tasks is the new Phase 1b feature so it's dominant. Last 5 actions is reference info (non-interactive, mid-page). Conditional cards hide when not relevant.

### 4. Polish bundle scope confirmation
**Decided:** All 7 STATE.md polish items ship in Phase 1b, bundled into a single "polish + bugfix" plan (likely Plan 01B-04 with the task views).
**Rationale:** All 7 items touch components 1b is already modifying (sidebar, session-card, project-list). Splitting creates two phases editing the same files; merging keeps the discuss-plan-execute loop short. Estimated 2-3 days of polish on top of 5-7 days of task layer work.

## Other decisions captured

- Task lifecycle: `'open' | 'done' | 'abandoned'` enum. `abandoned` reserved for manual use. Bucket-G auto-closes to `done` on SessionEnd; all other buckets manual-only.
- Goals migration: keep `projects.goals` column for one release as a denormalized safety net. Drop in a separate followup plan after 1b ships + 1 week soak.
- WebSocket envelope: `{ taskId, op, task }` and `{ sessionId, taskId, op, linkSource }`. Symmetric so client uses one switch handler.
- Audit trail storage: new `task_audit` table (task_id, actor, event, from_value, to_value, at). Append-only.

## Deferred to v2 / future phases

- Notion daily-task-chart sync (NOTION-01 candidate, schema reserves `external_ref` + `source='notion'`)
- Multi-actor audit (REMOTE-02 territory)
- Bulk task operations
- Task tags/labels (extending existing session-scoped Label system)
- Task templates
- Drop `projects.goals` column (separate plan post-1b)
- Auto-set Windows Terminal tab color via OSC (v2)
- Remote terminal attachment (REMOTE-01)
- Service-worker push (PUSH-01)

## Items the user can redirect

Every decision in `01B-CONTEXT.md` is reversible by editing the file or by telling me "change X to Y". The 4 most likely candidates for redirect:

1. **/tasks list layout** (row list vs kanban/table) - if you've seen a kanban tool you specifically like and want this to mirror it, say so
2. **Detail page single-scroll vs tabs** - personal taste; some people prefer tabs to keep scrolling shallow
3. **Keep `projects.goals` for a release** - if you'd rather drop it immediately and trust the migration, say so
4. **Polish bundle as one plan vs scattered** - planner can re-bundle if you want polish work first

---
*Auto-decided per the binding feedback memory. Scot was asked zero questions during this run.*
