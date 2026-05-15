// app/server/src/routes/sessions.ts
import { Hono } from 'hono'
import type { EventStore } from '../storage/types'
import { config } from '../config'
import { apiError } from '../errors'
import {
  deriveStatus,
  coerceWireLastActivity,
  type DerivedStatusFields,
} from '../lib/derive-status'

// Legacy two-state status field; 7+ in-repo consumers still read it
// (sidebar Unassigned bucket, settings tabs, modals, labels,
// session-list.tsx). Phase 1b migrates those consumers and removes
// this helper. Do NOT delete in Phase 1a (H1 mitigation).
function deriveSessionStatus(stoppedAt: number | null | undefined): string {
  return stoppedAt ? 'ended' : 'active'
}

// High-limit callers (settings, projects-tab) skip per-row event
// derivation to avoid the 1+10000-query storm under TanStack prefix
// invalidation. Home view's useRecentSessions(30) is well under the
// cap and gets full derivation. New-H2 mitigation: bounds total
// per-request event lookups at min(rowCount, DERIVED_LIMIT_THRESHOLD).
const DERIVED_LIMIT_THRESHOLD = 50
const RECENT_EVENTS_PER_SESSION = 50

/**
 * Placeholder derived fields used when the request limit exceeds
 * DERIVED_LIMIT_THRESHOLD. Returns shape-stable wire fields without
 * any per-row event lookup. Trade-off documented in the threat model
 * (T-01A-01-04 mitigation).
 */
function placeholderDerived(stoppedAt: number | null | undefined): DerivedStatusFields {
  return {
    derivedStatus: stoppedAt ? 'FINISHED' : 'WORKING',
    statusDetail: null,
    needsYou: false,
    lastActionLabel: null,
    lastActionAt: null,
  }
}

function parseAgentClasses(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw) return []
  return raw.split(',').filter(Boolean)
}

type Env = {
  Variables: {
    store: EventStore
    broadcastToSession: (sessionId: string, msg: object) => void
    broadcastToAll: (msg: object) => void
  }
}

const LOG_LEVEL = config.logLevel

const router = new Hono<Env>()

/**
 * Compose the wire-shape response row. Existing legacy fields are
 * kept verbatim (including the two-state `status` field consumers
 * still read). The five new HOME-01 derived fields are appended.
 *
 * `lastActivity` is coerced via `coerceWireLastActivity` so the wire
 * field is never null (Round 3 New-H mitigation: keeps the existing
 * client type `RecentSession.lastActivity: number` honest, avoids
 * NaN at the three call sites that feed it to formatRelativeTime
 * and numeric sort).
 */
function rowToRecentSession(r: any, derived: DerivedStatusFields) {
  return {
    id: r.id,
    projectId: r.project_id,
    projectName: r.project_name,
    projectSlug: r.project_slug,
    slug: r.slug,
    intent: r.intent ?? null,
    intentSource: (r.intent_source as 'manual' | 'auto' | null) ?? null,
    transcriptPath: r.transcript_path || null,
    startCwd: r.start_cwd || null,
    status: deriveSessionStatus(r.stopped_at),
    startedAt: r.started_at,
    stoppedAt: r.stopped_at,
    metadata: r.metadata ? JSON.parse(r.metadata) : null,
    agentCount: r.agent_count,
    eventCount: r.event_count,
    lastActivity: coerceWireLastActivity(r),
    agentClasses: parseAgentClasses(r.agent_classes),
    // New HOME-01 fields. Legacy `status` above stays unchanged for
    // the 7+ in-repo consumers still reading it.
    derivedStatus: derived.derivedStatus,
    statusDetail: derived.statusDetail,
    needsYou: derived.needsYou,
    lastActionLabel: derived.lastActionLabel,
    lastActionAt: derived.lastActionAt,
  }
}

// GET /sessions/recent
router.get('/sessions/recent', async (c) => {
  const store = c.get('store')
  const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!) : 20
  const rows = await store.getRecentSessions(limit)

  // High-limit callers skip per-row derivation; home view (limit=30)
  // gets full derivation.
  if (limit > DERIVED_LIMIT_THRESHOLD) {
    return c.json(rows.map((r: any) => rowToRecentSession(r, placeholderDerived(r.stopped_at))))
  }

  const now = Date.now()
  const enriched = await Promise.all(
    rows.map(async (r: any) => {
      const events = await store.getRecentEventsForSession(r.id, RECENT_EVENTS_PER_SESSION)
      const derived = deriveStatus(r, events, now)
      return rowToRecentSession(r, derived)
    }),
  )
  return c.json(enriched)
})

// GET /sessions/unassigned — sessions with project_id IS NULL, used by
// the sidebar's "Unassigned" bucket. Avoids the previous client-side
// filter on /sessions/recent that pulled rows the sidebar would
// immediately throw away.
router.get('/sessions/unassigned', async (c) => {
  const store = c.get('store')
  const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!) : 100
  const rows = await store.getUnassignedSessions(limit)
  // Sidebar reads legacy `status`, not `derivedStatus`. Use
  // placeholders to avoid paying for per-row event lookups here.
  return c.json(rows.map((r: any) => rowToRecentSession(r, placeholderDerived(r.stopped_at))))
})

// GET /sessions/:id
router.get('/sessions/:id', async (c) => {
  const store = c.get('store')
  const sessionId = decodeURIComponent(c.req.param('id'))
  const row = await store.getSessionById(sessionId)
  if (!row) return apiError(c, 404, 'Session not found')

  // Single-row endpoint: always derive. Cost is 1 + 1.
  const events = await store.getRecentEventsForSession(sessionId, RECENT_EVENTS_PER_SESSION)
  const derived = deriveStatus(row, events, Date.now())

  return c.json({
    id: row.id,
    projectId: row.project_id,
    projectSlug: row.project_slug,
    projectName: row.project_name,
    slug: row.slug,
    intent: row.intent ?? null,
    intentSource: (row.intent_source as 'manual' | 'auto' | null) ?? null,
    status: deriveSessionStatus(row.stopped_at),
    startedAt: row.started_at,
    stoppedAt: row.stopped_at,
    transcriptPath: row.transcript_path || null,
    startCwd: row.start_cwd || null,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
    agentCount: row.agent_count,
    eventCount: row.event_count,
    lastActivity: coerceWireLastActivity(row),
    agentClasses: parseAgentClasses(row.agent_classes),
    // New HOME-01 fields. Legacy `status` above stays unchanged.
    derivedStatus: derived.derivedStatus,
    statusDetail: derived.statusDetail,
    needsYou: derived.needsYou,
    lastActionLabel: derived.lastActionLabel,
    lastActionAt: derived.lastActionAt,
  })
})

// GET /sessions/:id/agents
router.get('/sessions/:id/agents', async (c) => {
  const store = c.get('store')
  const sessionId = decodeURIComponent(c.req.param('id'))
  const rows = await store.getAgentsForSession(sessionId)
  const agents = rows.map((r: any) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    agentType: r.agent_type || null,
    agentClass: r.agent_class || null,
  }))
  return c.json(agents)
})

// Allow-list of opt-in `fields=` values. Default response omits all of
// these; clients pass `?fields=sessionId,cwd,createdAt,_meta` to opt in.
const OPT_IN_FIELDS = new Set(['sessionId', 'cwd', 'createdAt', '_meta'])

// GET /sessions/:id/events
router.get('/sessions/:id/events', async (c) => {
  const store = c.get('store')
  const sessionId = decodeURIComponent(c.req.param('id'))
  const sinceParam = c.req.query('since')
  const agentIdParam = c.req.query('agentId')
  const fieldsParam = c.req.query('fields')

  const requested = new Set(
    (fieldsParam ?? '')
      .split(',')
      .map((f) => f.trim())
      .filter((f) => OPT_IN_FIELDS.has(f)),
  )

  const rows = sinceParam
    ? await store.getEventsSince(sessionId, parseInt(sinceParam))
    : await store.getEventsForSession(sessionId, {
        agentIds: agentIdParam ? agentIdParam.split(',') : undefined,
        hookName: c.req.query('hookName') || undefined,
        search: c.req.query('search') || undefined,
        limit: c.req.query('limit') ? parseInt(c.req.query('limit')!) : undefined,
        offset: c.req.query('offset') ? parseInt(c.req.query('offset')!) : undefined,
      })

  interface EventRow {
    id: number
    agentId: string
    hookName: string
    timestamp: number
    payload: unknown
    [key: string]: unknown
  }

  const events: EventRow[] = rows.map((r) => {
    const base: EventRow = {
      id: r.id,
      agentId: r.agent_id,
      hookName: r.hook_name,
      timestamp: r.timestamp,
      payload: JSON.parse(r.payload),
    }
    if (requested.has('sessionId')) base.sessionId = r.session_id
    if (requested.has('cwd')) base.cwd = r.cwd ?? null
    if (requested.has('createdAt')) base.createdAt = r.created_at ?? r.timestamp
    if (requested.has('_meta')) base._meta = r._meta ? JSON.parse(r._meta) : null
    return base
  })

  // Lazy session status correction based on event history.
  if (events.length > 0) {
    let lastSessionEndIdx = -1
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].hookName === 'SessionEnd') {
        lastSessionEndIdx = i
        break
      }
    }
    const session = await store.getSessionById(sessionId)
    if (session) {
      const isStopped = !!session.stopped_at
      if (lastSessionEndIdx >= 0 && lastSessionEndIdx === events.length - 1 && !isStopped) {
        await store.updateSessionStatus(sessionId, 'stopped')
      } else if (lastSessionEndIdx >= 0 && lastSessionEndIdx < events.length - 1 && isStopped) {
        await store.updateSessionStatus(sessionId, 'active')
      } else if (lastSessionEndIdx < 0 && isStopped) {
        await store.updateSessionStatus(sessionId, 'active')
      }
    }
  }

  return c.json(events)
})

// PATCH /sessions/:id — update session table fields (slug, projectId, intent)
router.patch('/sessions/:id', async (c) => {
  const store = c.get('store')
  const broadcastToAll = c.get('broadcastToAll')

  try {
    const sessionId = decodeURIComponent(c.req.param('id'))
    const data = (await c.req.json()) as Record<string, unknown>

    if (typeof data.slug === 'string') {
      const slug = data.slug.trim()
      if (!slug) return apiError(c, 400, 'slug must not be empty')
      await store.updateSessionSlug(sessionId, slug)

      if (LOG_LEVEL === 'debug') {
        console.log(`[METADATA] Session ${sessionId.slice(0, 8)} slug: ${slug}`)
      }

      broadcastToAll({ type: 'session_update', data: { id: sessionId, slug } as any })
    }

    if (data.projectId && typeof data.projectId === 'number') {
      await store.updateSessionProject(sessionId, data.projectId)
      broadcastToAll({
        type: 'session_update',
        data: { id: sessionId, projectId: data.projectId },
      })
    }

    // Intent: trim, cap at 200 chars to prevent runaway prompts being
    // pasted in. Source defaults to 'manual' (the slash command path);
    // hooks pass 'auto' explicitly. The store enforces the sticky-manual
    // rule so we don't have to here.
    if ('intent' in data) {
      const raw = data.intent
      const intent =
        raw === null ? null : typeof raw === 'string' ? raw.trim().slice(0, 200) || null : null
      const source: 'manual' | 'auto' = data.intentSource === 'auto' ? 'auto' : 'manual'
      await store.updateSessionIntent(sessionId, intent, source)

      if (LOG_LEVEL === 'debug') {
        console.log(
          `[METADATA] Session ${sessionId.slice(0, 8)} intent (${source}): ${intent ?? '(cleared)'}`,
        )
      }

      // Re-fetch so we broadcast the post-write value (auto-source
      // writes can be no-ops when a manual intent is already set).
      const after = await store.getSessionById(sessionId)
      broadcastToAll({
        type: 'session_update',
        data: {
          id: sessionId,
          intent: after?.intent ?? null,
          intentSource: (after?.intent_source as 'manual' | 'auto' | null) ?? null,
        } as any,
      })
    }

    return c.json({ ok: true })
  } catch {
    return apiError(c, 400, 'Invalid request')
  }
})

// PATCH /sessions/:id/metadata — merge keys into session metadata JSON
router.patch('/sessions/:id/metadata', async (c) => {
  const store = c.get('store')

  try {
    const sessionId = decodeURIComponent(c.req.param('id'))
    const patch = (await c.req.json()) as Record<string, unknown>

    if (!patch || typeof patch !== 'object' || Object.keys(patch).length === 0) {
      return apiError(c, 400, 'Provide at least one key to patch')
    }

    await store.patchSessionMetadata(sessionId, patch)
    return c.json({ ok: true })
  } catch {
    return apiError(c, 400, 'Invalid request')
  }
})

export default router
