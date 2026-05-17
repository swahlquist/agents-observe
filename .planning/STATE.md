---
gsd_state_version: 1.0
milestone: v0.9.5
milestone_name: milestone
current_phase: 01B
status: context_captured
last_updated: "2026-05-16T16:30:00.000Z"
progress:
  total_phases: 2
  completed_phases: 1
  total_plans: 2
  completed_plans: 2
  percent: 50
---

# Project State

**Project:** Agents Observe (Founder-Mode Home View + Task/Session Tracking v1)
**Initialized:** 2026-05-13
**Current Phase:** 01A (complete, soaking)
**Next Action:** Soak Phase 1a under real-world use for ~24h. On 2026-05-16 (or after sufficient observation), decide: file followup fixes for 1a, OR run `/gsd-discuss-phase 1b`. Visual-readability concerns surfaced 2026-05-15 may warrant a new Phase 1c (visual refresh) inserted before 1b.

## Status

| Stage | Status |
|-------|--------|
| PROJECT.md | Created |
| config.json | Created |
| Research | Skipped (already done in originating conversation, agents not installed globally) |
| REQUIREMENTS.md | Created |
| ROADMAP.md | Created |
| STATE.md | Created |
| Phase 1a discuss | Done (auto mode), see 01A-CONTEXT.md + 01A-DISCUSSION-LOG.md |
| Phase 1a plan | Done (2 plans, 2 waves; 01A-01 server, 01A-02 client) |
| Phase 1a execute | Done (2026-05-15), server + client merged to main, 879 tests passing |
| Phase 1a code review | Done (2026-05-15), 15 findings, 10 fixed (3 BLOCKER + 7 WARNING), 5 INFO deferred |
| Phase 1a soak | In progress (2026-05-15 to 2026-05-16) |
| Phase 1b discuss | Done (2026-05-16, auto-decide mode), see 01B-CONTEXT.md + 01B-DISCUSSION-LOG.md |
| Phase 1b plan | Pending: run `/gsd-plan-phase 1b` next |
| Phase 1b execute | Pending |

## Phase Memory

### Phase 1a

- 2026-05-13: Context captured in auto mode (user "work without stopping" instruction active). 11 gray areas resolved: status thresholds (60s WORKING / 30min ABANDONED matching existing pulse + overlap windows), notification text parsing via regex, lastActionLabel format, tab title format, Web Audio bell spec, client-side category icon mapping, 8-color session hash, expanded-by-default project groups, local-midnight finished-today cutoff, placeholder Overview tab, per-section empty states. Two plans planned: Plan 1 server derivation (3d), Plan 2 client redesign (3-4d). No schema migration in 1a. See `.planning/phases/01A-home-view-derived-status/01A-CONTEXT.md`.
- 2026-05-14: Plans written via `/gsd-plan-phase 1a` (yolo mode, planner ran inline via general-purpose since gsd-planner agent not installed globally). 01A-01 covers HOME-01/02/11/12 (server derived fields, vitest tests against real journal Notification strings). 01A-02 covers HOME-03..10, 13, 14, 15 (client redesign, side-effect hooks, SessionView Overview/Activity tabs). Both plans validate: frontmatter passes plan schema, structure check returns valid with 2 and 3 tasks respectively, zero `files_modified` overlap (Plan 01 server-only, Plan 02 client-only). Post-planning gap analysis: 15/15 HOME-XX covered; the 18 TASK-XX "Not covered" rows are Phase 1b scope, expected.

- 2026-05-15: Phase 1a execute complete. Server (01A-01) and client (01A-02) plans both landed, merged via worktree mode. Code review found 15 issues; gsd-code-fixer applied 10 atomic commits (CR-01..CR-03 blockers, WR-01..WR-07 warnings). 5 INFO findings deferred (no `--all`). Final test count: 879 (237 hooks + 371 server + 271 client). Soak begins now; gate to Phase 1b is "no derived-status bug significant enough to block tasks layer." Real-world visual feedback from Scot on 2026-05-15: dashboard is functional but reads as developer-IDE aesthetic, hard for non-dev team. Visual refresh likely needed before 1b ships value to non-dev users.

### Phase 1b

- Not yet discussed. Blocked on Phase 1a shipping plus 24 hours of live use. May be preceded by a new Phase 1c (visual refresh, Trello/Monday-style) if 2026-05-15 readability concern hardens into a real requirement.

## Decisions Made During Initialization

See `PROJECT.md` § Key Decisions for the full list. Highlights:

- v1 split into Phase 1a (UI) and Phase 1b (tasks layer)
- Migrate `projects.goals` JSON into the new `tasks` table
- Derive status and `needsYou` at query time, do not store
- v1 ships bell + tab title only; defer service-worker push to v2
- Vercel-style row list with Linear-style "needs you" pile
- Existing systemd user service is the auto-start mechanism; ignore `[boot] command =`
- Do not rebase against `upstream/main` v0.9.5 inside this project

## Open Items

- Origin push pending: `git push --force-with-lease origin main` requires user run (denied at permission layer in initiating session).
- Audible bell sound choice not yet selected. Default placeholder is a single short tone; final asset to be picked during Phase 1a Plan 2.
- After goals to tasks migration ships in Phase 1b, decide whether to drop the `projects.goals` column in a follow-up release or keep it as a denormalized cache.
- **Notion daily task chart sync** (post-1b, future phase): Scot's stated end-state is the agents-observe task model surfacing as a daily task chart in Notion alongside his other tracked work. Depends on Phase 1b shipping the tasks layer first. Candidate v2 requirement (NOTION-01 or similar). Captured 2026-05-15.
- **Phase 1b scope addition (small polish)**: drop `>_` prefix on session rows, replace 2px color stripe with filled status chip, hide or rename git-hash placeholders in Unassigned sidebar. Captured 2026-05-15 from Scot's readability feedback.
- **Phase 1b scope addition (terminal-tab correlation, headline UX)**: 2026-05-16 Scot can't visually tie a dashboard row to a Windows Terminal tab. Fix candidates: (a) replace 2px per-session color stripe with a 16-24px visible chip, (b) add 2-letter or emoji session label next to the chip, (c) docs recipe for manually renaming Windows Terminal tabs to match project names. Out of scope but logged: auto-set Windows Terminal tab color via OSC escape codes on session start (v2 candidate).
- **Phase 1b scope addition (font sizing)**: 2026-05-16 base font + card padding bumped 2-3pt for legibility per Scot feedback.
- **Phase 1b scope addition (collapse Gemini-vs-Claude split)**: 2026-05-16 Scot observed that `gemini-ai-company-brain (47)` and `ai-company-brain (0)` show as separate sidebar projects even though they're the same cwd, just different clients. Confusing for daily-scan. Proposal: collapse `gemini-X` and `X` into a single `X` folder with a per-session client badge (e.g. small "C" / "G" chip on each session card). Project derivation lives server-side; needs a small change to strip the `gemini-` prefix when computing project key, plus client tracking on the session row.
- **Phase 1a followup bug (stripe-rotation-runbook stale green dot)**: 2026-05-16 confirmed via `/today` that no real process matches the `docs/stripe-rotation-runbook:3163...` session, but the sidebar shows it with a green pulse dot. Hypothesis: `useProjectPulseActive` (or the underlying pulse-active hook) uses a different time window than the WORKING/IDLE/ABANDONED status cascade, and stays lit indefinitely when SessionEnd was missed (process killed instead of exiting cleanly). Fix in 1b polish since 1b is already touching sidebar rendering. Affects: `app/client/src/hooks/use-pulse-active.ts` (or similar).

---
*Last updated: 2026-05-13 after Phase 1a context capture*
