export interface Project {
  id: number
  slug: string
  name: string
  createdAt: number
  sessionCount?: number
}

export interface Label {
  id: string
  name: string
  createdAt: number
}

export interface Session {
  id: string
  // Sessions whose project hasn't been resolved yet have `projectId:
  // null`. The sidebar groups those into a synthetic "Unassigned"
  // bucket; users can move them via the SessionEditModal.
  projectId: number | null
  // Nullable to accommodate Unassigned sessions (project_id IS NULL on
  // the server). The /sessions/recent payload now carries explicit
  // null for these; the per-project /projects/:id/sessions response
  // still always populates them.
  projectSlug?: string | null
  projectName?: string | null
  transcriptPath?: string | null
  slug: string | null
  // Human-readable session goal. Set explicitly via the /intent slash
  // command, or auto-derived from the first user prompt. Rendered as
  // the row title in the dashboard so users can scan a list of
  // sessions and immediately know what each one is for. Null until a
  // prompt arrives or /intent is run.
  intent?: string | null
  intentSource?: 'manual' | 'auto' | null
  // Status is a derived field. Server returns either `'active'` or
  // `'ended'`/`'stopped'`, computed from `stoppedAt`. The column is gone
  // from the schema; this string lives on the API response only.
  status: string
  startedAt: number
  stoppedAt: number | null
  metadata: Record<string, unknown> | null
  lastActivity: number | null
  // Distinct agent_class values across every agent in the session (root +
  // subagents). Empty array for legacy sessions predating the column.
  agentClasses: string[]
}

/** Agent metadata from the server — no derived state.
 *  Parent / hierarchy fields are NOT here; per spec the server is
 *  agent-class-agnostic and Layer 3 derives parent/child from events. */
export interface ServerAgent {
  id: string
  name: string | null
  description: string | null
  agentType?: string | null
  agentClass?: string | null
}

/** Agent with UI-derived state (computed from events).
 *  parentAgentId is derived client-side from spawn events (e.g.
 *  Claude Code's PostToolUse:Agent → tool_response.agentId), NOT
 *  read from the server. sessionId is the session-context this Agent
 *  was constructed for. */
export interface Agent extends ServerAgent {
  sessionId: string
  parentAgentId: string | null
  status: 'active' | 'stopped'
  eventCount: number
  firstEventAt: number | null
  lastEventAt: number | null
  cwd?: string | null
}

/**
 * Wire-shape event from the server. Identity + raw payload only — Layer
 * 3 derives display fields (toolName, status, etc.) per agent class.
 *
 * The default `/sessions/:id/events` response includes only the
 * REQUIRED fields below. Clients can opt into the optional fields via
 * `?fields=sessionId,cwd,createdAt,_meta`.
 */
export interface ParsedEvent {
  // Required — always returned
  id: number
  agentId: string
  hookName: string
  timestamp: number
  payload: Record<string, unknown>

  // Optional — opt-in via `fields=` or carried by WS broadcast
  sessionId?: string
  createdAt?: number
  cwd?: string | null
  _meta?: Record<string, unknown> | null
}

/**
 * Six-state derived status union, computed server-side per Phase 1a
 * Plan 01. Replaces the legacy two-state `status` for visual rendering;
 * the legacy `status: string` field stays on the wire (and on this
 * interface) for the 7+ in-repo consumers that still read it.
 */
export type SessionStatus =
  | 'WORKING'
  | 'WAITING_FOR_INPUT'
  | 'WAITING_ON_PERMISSION'
  | 'IDLE'
  | 'FINISHED'
  | 'ABANDONED'

export interface RecentSession {
  id: string
  // Sessions whose project hasn't been resolved yet carry `projectId:
  // null`. The /sessions/recent endpoint includes them so the sidebar
  // Unassigned bucket can pick them up alongside assigned sessions.
  projectId: number | null
  projectSlug: string | null
  projectName: string | null
  slug: string | null
  // See Session.intent for full semantics; same field, mirrored here
  // because /sessions/recent returns RecentSession not Session.
  intent?: string | null
  intentSource?: 'manual' | 'auto' | null
  transcriptPath?: string | null
  // Legacy two-state status. Kept on the wire (and read by 7+ in-repo
  // consumers including the sidebar Unassigned bucket, settings tabs,
  // modals, labels). Phase 1b migrates them and drops this field; in
  // Phase 1a it sits next to the new `derivedStatus` six-state union.
  status: string
  startedAt: number
  stoppedAt: number | null
  metadata: Record<string, unknown> | null
  // Server-side coerced to `(last_activity ?? started_at)` per Plan 01;
  // therefore never null on the wire. Kept typed as `number` so the
  // existing in-repo call sites (labels-modal, session-modal sort and
  // formatRelativeTime) do not need null guards.
  lastActivity: number
  agentClasses: string[]
  // Aggregate counts derived server-side via subqueries on the events
  // and agents tables. Both routes (`/sessions/recent` and
  // `/projects/:id/sessions`) populate them so the projects-tab can
  // sum them per-project without an extra round trip.
  eventCount?: number
  agentCount?: number
  // New derived fields shipped by Phase 1a Plan 01.
  // Six-state classification used by the new home-view card render.
  // Server derives at query time from {stoppedAt, pending_notification_ts,
  // last_activity}; no schema migration. The legacy `status` above is the
  // two-state mirror kept for backwards compatibility.
  derivedStatus: SessionStatus
  // Sub-state context. For WAITING_ON_PERMISSION this is the tool name
  // parsed out of the most recent Notification message (e.g. "Bash"),
  // capped at 64 chars. For other states usually null.
  statusDetail: string | null
  // True iff `derivedStatus` is WAITING_FOR_INPUT or WAITING_ON_PERMISSION.
  // The home view sorts these into a single "Needs You" pile at the top
  // and triggers the tab title + bell side effects on false-to-true flips.
  needsYou: boolean
  // Human-readable label for the most recent meaningful event on the
  // session (e.g. "Running Bash", "Prompt: ...", "Waiting on Bash
  // permission"). Capped at 60 chars server-side.
  lastActionLabel: string | null
  // Wall-clock ms timestamp of the event that produced `lastActionLabel`,
  // or null when no events are present.
  lastActionAt: number | null
}

export interface NotificationPayload {
  sessionId: string
  projectId: number
  latestNotificationTs: number
}

/**
 * Trimmed wire shape for the per-session WS broadcast. Per spec
 * §"Wire Protocols", broadcasts carry only the minimum needed to
 * render a row — display fields are derived client-side.
 *
 * The server emits camelCase fields today (matching `ParsedEvent`).
 * We type defensively so the boundary parser tolerates either casing
 * in case the broadcast is ever trimmed to the spec-canonical
 * snake_case form (`{id, timestamp, agent_id, hook_name, payload}`).
 */
export interface WSEventBroadcast {
  id: number
  timestamp: number
  agentId?: string
  agent_id?: string
  hookName?: string
  hook_name?: string
  sessionId?: string
  session_id?: string
  cwd?: string | null
  _meta?: Record<string, unknown> | null
  payload: Record<string, unknown>
}

export type WSMessage =
  | { type: 'event'; data: WSEventBroadcast }
  | { type: 'session_update'; data: Session }
  | { type: 'project_update'; data: { id: number; name: string } }
  | { type: 'notification'; data: { sessionId: string; projectId: number; ts: number } }
  | { type: 'notification_clear'; data: { sessionId: string; ts: number } }
  | {
      type: 'activity'
      data: { sessionId: string; projectId: number | null; eventId: number; ts: number }
    }
  | { type: 'overlaps_update' }
  | { type: 'project_goals_update'; data: { projectId: number } }

export type WSClientMessage = { type: 'subscribe'; sessionId: string } | { type: 'unsubscribe' }
