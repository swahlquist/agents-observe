# Phase 1a Discussion Log

**Phase:** 1a (Home View + Derived Status)
**Captured:** 2026-05-13
**Mode:** auto (Claude-resolved from prior alignment; user instruction was "work without stopping for clarifying questions")
**Workflow:** `/gsd-discuss-phase 1a`

This log is for audit/retrospective only. Downstream agents (researcher, planner, executor) read `01A-CONTEXT.md`, not this file.

## How this phase was scoped

Phase 1a inherits a thoroughly pre-decided context. PROJECT.md captures 8 Key Decisions and REQUIREMENTS.md locks 15 HOME-* requirements. The standard discuss-phase loop (gray-area selection + multi-turn Q&A) would have asked the user to re-decide things they already decided in the originating conversation. Per the active "work without stopping" instruction, Claude switched to auto-mode and resolved the remaining gray areas inline.

## Gray areas identified and resolved

| Gray area | Resolution | Rationale |
|---|---|---|
| Status thresholds (WORKING/IDLE/ABANDONED cutoffs) | 60 s WORKING, 30 min IDLE→ABANDONED | Matches existing pulse decay (`ACTIVITY_CONFIG.pulseDurationMs`) and existing overlap-window (30 min). Single source of truth for both timers. |
| Permission vs input distinction | Regex parse on Notification message text, applied on read | Existing journal contains the message; storing a parsed category would mean a migration and a sync point. Parsing on read is O(1) per session and tolerates Claude Code wording drift. |
| `lastActionLabel` format | Per-event-type table, max 60 chars, ellipsis = `…` (U+2026) | Matches the human-readable cadence of `~/ai-company-brain/scripts/today-summary.sh`. The Unicode ellipsis avoids the three-dot ASCII form that some terminals re-render as an em dash. |
| Tab title format | `(N) intent · agents-observe` for N=1, `(N) sessions need you · agents-observe` for N>1 | Middle dot (`·`) is not an em dash. Format avoids em dash hard rule. |
| Bell sound | Web Audio 800 Hz sine, 150 ms, generated in-browser | No external asset to ship. Mutable via `ui-store.bellEnabled`, parallel to existing `notificationsEnabled` pattern. Final asset choice deferred. |
| Category icon (Phase 1a, client-side) | Keyword match on intent text → lucide-react icon | No schema change in 1a. Phase 1b moves this server-side via `sessions.category` column. |
| Color stripe | `hash(session_id) % 8` mapped to brand-safe palette | Stable per session. 8 buckets is enough to distinguish typical 4-5 parallel session view without being noisy. |
| Project group default state | Expanded, no persistence in 1a | Persistence is a Phase 1b polish item, not a 1a requirement. |
| Finished today cutoff | `stopped_at >= local midnight today` (client-side) | Matches user mental model. Browser timezone is correct for a single-user dashboard. |
| Overview tab content (Phase 1a) | Placeholder showing intent + status + "tasks arriving in 1b" | The real Overview content depends on the `tasks` table which lands in 1b. Placeholder is honest. |
| Empty states | Per-section copy specified | Avoids generic "No results" emptiness; tone is calm and informative. |

## Deferred ideas

Captured for later phases / backlog; not in 1a scope:

- Per-project group collapsed-state persistence
- Bell sound asset chooser (multi-tone, user picks)
- Status-aware row sorting inside a project group (e.g., needsYou first, then WORKING)
- Service-worker push notifications (Phase 2, PUSH-01)
- Context window % per session (depends on token tracking)
- Remote terminal / multi-user (REMOTE-01..03)
- Upstream rebase against `simple10/agents-observe` v0.9.5 (separate chore branch)

## Out of scope flagged

None. The user's prior brief had already redirected scope creep to deferred ideas. No new creep emerged during 1a context capture.

## Notes for the planner

- The planner should split Phase 1a into two plans, as ROADMAP.md already suggests:
  - Plan 1: Server status derivation + tests (3 days). Pure backend on existing routes. New unit tests using captured journal messages.
  - Plan 2: Client redesign + side effects (3-4 days). New components, HomePage rewrite, tab title + bell hooks, SessionView Overview/Activity rename.
- The planner must not introduce a schema migration in Phase 1a. Any migration is Phase 1b.
- The planner must check `app/server/src/storage/sqlite-adapter.ts:93-167` before designing the derivation helper. The `pending_notification_ts` infrastructure is the load-bearing primitive; do not duplicate it.
- The planner should plan to remove the existing sort-toggle button on `home-page.tsx` (lines 24-54). The new layout has implicit sort (Needs You → projects → finished); a global sort toggle becomes meaningless.

---
*Discussion log captured: 2026-05-13.*
