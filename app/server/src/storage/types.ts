// app/server/src/storage/types.ts

export interface InsertEventParams {
  agentId: string
  sessionId: string
  /** Raw hook event name from the envelope. */
  hookName: string
  timestamp: number
  payload: Record<string, unknown>
  /** Per-event cwd (lifted from envelope). Optional. */
  cwd?: string | null
  /** Envelope creation hints persisted for traceability. Optional. */
  _meta?: Record<string, unknown> | null
}

export interface InsertEventResult {
  eventId: number
}

export interface EventFilters {
  agentIds?: string[]
  hookName?: string
  search?: string
  limit?: number
  offset?: number
}

export interface StoredEvent {
  id: number
  agent_id: string
  session_id: string
  hook_name: string
  timestamp: number
  created_at: number
  cwd: string | null
  _meta: string | null // JSON string in DB
  payload: string // JSON string in DB
}

export interface AgentPatch {
  name?: string | null
  description?: string | null
  agent_type?: string | null
}

export interface EventStore {
  createProject(slug: string, name: string): Promise<number>
  getProjectById(id: number): Promise<any | null>
  getProjectBySlug(slug: string): Promise<any | null>
  updateProjectName(projectId: number, name: string): Promise<void>
  /**
   * Read the parsed goals array for a project. Returns `[]` if the
   * project doesn't exist or its goals column is empty / malformed,
   * so callers never have to guard against null.
   */
  getProjectGoals(projectId: number): Promise<ProjectGoal[]>
  /**
   * Replace the full goals array. The route layer is the source of
   * truth for shape validation; this method just JSON-encodes and
   * writes. Bumps `updated_at`.
   */
  setProjectGoals(projectId: number, goals: ProjectGoal[]): Promise<void>
  isSlugAvailable(slug: string): Promise<boolean>
  /**
   * Find-or-create a project by slug. Uses INSERT ... ON CONFLICT(slug)
   * DO NOTHING followed by SELECT, so concurrent inserts converge on
   * the same row. Never auto-suffixes.
   */
  findOrCreateProjectBySlug(
    slug: string,
    name?: string,
  ): Promise<{ id: number; slug: string; created: boolean }>
  /**
   * Look up a session that already has a project, matching by either
   * `start_cwd` or `dirname(transcript_path)`. Used by project
   * resolution when `flags.resolveProject` fires.
   */
  findSiblingSessionWithProject(input: {
    startCwd: string | null
    transcriptBasedir: string | null
    excludeSessionId: string
  }): Promise<{ projectId: number } | null>
  deleteProject(
    projectId: number,
  ): Promise<{ sessionIds: string[]; sessions: number; agents: number; events: number }>
  upsertSession(
    id: string,
    projectId: number | null,
    slug: string | null,
    metadata: Record<string, unknown> | null,
    timestamp: number,
    transcriptPath?: string | null,
    startCwd?: string | null,
  ): Promise<void>
  upsertAgent(
    id: string,
    sessionId: string,
    parentAgentId: string | null,
    name: string | null,
    description: string | null,
    agentType?: string | null,
    agentClass?: string | null,
  ): Promise<void>
  /** Layer 3 patch path. Only `name`, `description`, `agent_type` honored. */
  patchAgent(id: string, patch: AgentPatch): Promise<any | null>
  updateAgentType(id: string, agentType: string): Promise<void>
  updateSessionStatus(id: string, status: string): Promise<void>
  patchSessionMetadata(sessionId: string, patch: Record<string, unknown>): Promise<void>
  updateSessionSlug(sessionId: string, slug: string): Promise<void>
  /**
   * Set the human-readable session intent. `source: 'manual'` (from the
   * /intent slash command) is sticky and overrides any prior value.
   * `source: 'auto'` (e.g. derived from the first user prompt) only
   * writes when the existing intent is NULL or also auto-derived, so
   * manually-set intents never get clobbered.
   */
  updateSessionIntent(
    sessionId: string,
    intent: string | null,
    source: 'manual' | 'auto',
  ): Promise<void>
  updateSessionProject(sessionId: string, projectId: number): Promise<void>
  updateAgentName(agentId: string, name: string): Promise<void>
  /** Set `pending_notification_ts = timestamp` and bump count + last. */
  startSessionNotification(sessionId: string, timestamp: number): Promise<void>
  /** Clear pending notification state (count -> 0, ts -> NULL). */
  clearSessionNotification(sessionId: string): Promise<void>
  /** Stamp `sessions.stopped_at = timestamp`. */
  stopSession(sessionId: string, timestamp: number): Promise<void>
  /** Update `sessions.last_activity` to MAX(current, timestamp). */
  touchSessionActivity(sessionId: string, timestamp: number): Promise<void>
  /**
   * Record that a session touched a file via a tool call. UPSERT on
   * (session_id, file_path) so the table stays one-row-per-pair and
   * needs no background pruning. `touched_at` only moves forward (we
   * never overwrite a newer touch with an older one).
   */
  recordFileTouch(params: {
    sessionId: string
    filePath: string
    toolName: string
    touchedAt: number
  }): Promise<void>
  /**
   * Find pairs of currently-active sessions (stopped_at IS NULL) that
   * have touched the same file path within the given lookback window.
   * `sinceTimestamp` is the lower bound (ms-epoch); rows older than
   * that are excluded on both sides. Pairs are deduplicated using
   * `session_a < session_b` so each unordered pair appears once.
   * Returns one row per (sessionA, sessionB, filePath); the route
   * layer is free to group by pair when composing the response.
   */
  findOverlappingSessions(sinceTimestamp: number): Promise<OverlapRow[]>
  insertEvent(params: InsertEventParams): Promise<InsertEventResult>
  getProjects(): Promise<any[]>
  getSessionsForProject(projectId: number): Promise<any[]>
  getSessionById(sessionId: string): Promise<any | null>
  getAgentById(agentId: string): Promise<any | null>
  getSessionsWithPendingNotifications(sinceTs: number): Promise<any[]>
  getAgentsForSession(sessionId: string): Promise<any[]>
  getEventsForSession(sessionId: string, filters?: EventFilters): Promise<StoredEvent[]>
  getEventsForAgent(agentId: string): Promise<StoredEvent[]>
  getEventsSince(sessionId: string, sinceTimestamp: number): Promise<StoredEvent[]>
  deleteSession(sessionId: string): Promise<{ events: number; agents: number }>
  deleteSessions(
    sessionIds: string[],
  ): Promise<{ events: number; agents: number; sessions: number }>
  clearAllData(): Promise<{ projects: number; sessions: number; agents: number; events: number }>
  clearSessionEvents(sessionId: string): Promise<{ events: number; agents: number }>
  getDbStats(): Promise<{ sessionCount: number; eventCount: number }>
  vacuum(): Promise<void>
  getRecentSessions(limit?: number): Promise<any[]>
  /** Sessions where project_id IS NULL — surfaced in the sidebar's
   *  "Unassigned" bucket. Server doesn't auto-assign post-refactor
   *  unless `flags.resolveProject` or `_meta.project.slug` is set, so
   *  these are genuinely user-actionable. */
  getUnassignedSessions(limit?: number): Promise<any[]>
  healthCheck(): Promise<{ ok: boolean; error?: string }>
  /**
   * Scan all tables for rows with broken foreign keys and repair them.
   * - Sessions with invalid project_id → project_id set to NULL
   * - Agents with no referencing events → deleted
   * - Events with invalid session_id or agent_id → deleted
   *
   * Returns a summary of what was repaired.
   */
  repairOrphans(): Promise<OrphanRepairResult>
}

export interface ProjectGoal {
  id: string
  text: string
  done: boolean
}

export interface OverlapRow {
  sessionA: string
  sessionB: string
  filePath: string
  aTouchedAt: number
  bTouchedAt: number
  aToolName: string
  bToolName: string
}

export interface OrphanRepairResult {
  sessionsReassigned: number
  agentsDeleted: number
  agentsReparented: number
  eventsDeleted: number
}
