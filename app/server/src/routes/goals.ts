import { Hono } from 'hono'
import type { EventStore, ProjectGoal } from '../storage/types'
import { apiError } from '../errors'

type Env = {
  Variables: {
    store: EventStore
    broadcastToAll: (msg: object) => void
  }
}

const router = new Hono<Env>()

const MAX_GOALS = 50
const MAX_GOAL_TEXT_LEN = 200
const MIN_LINK_LEN = 4

export interface ProjectGoalWithLink extends ProjectGoal {
  /** Session whose intent matches this goal text. Computed at read
   *  time (never persisted) so a renamed / moved session naturally
   *  unlinks without rewriting the goals column. */
  linkedSessionId: string | null
  linkedSessionSlug: string | null
  linkedSessionIntent: string | null
}

/**
 * Case-insensitive substring match between a goal and a session intent.
 * Either side containing the other counts. Gated on `MIN_LINK_LEN` chars
 * so trivially-short goals (e.g. "fix") don't latch onto half the
 * sessions in the project.
 */
function intentMatchesGoal(goalText: string, intent: string | null | undefined): boolean {
  if (!intent) return false
  const g = goalText.trim().toLowerCase()
  const i = intent.trim().toLowerCase()
  if (g.length < MIN_LINK_LEN || i.length < MIN_LINK_LEN) return false
  return i.includes(g) || g.includes(i)
}

router.get('/projects/:id/goals', async (c) => {
  const store = c.get('store')
  const projectId = Number(c.req.param('id'))
  if (!Number.isFinite(projectId)) return apiError(c, 400, 'Invalid project ID')

  const project = await store.getProjectById(projectId)
  if (!project) return apiError(c, 404, 'Project not found')

  const goals = await store.getProjectGoals(projectId)
  const sessions = (await store.getSessionsForProject(projectId)) as Array<{
    id: string
    slug: string | null
    intent: string | null
    stopped_at: number | null
  }>

  // Prefer active sessions when picking a link target so a closed
  // session doesn't shadow a current one editing the same thing.
  const sorted = [...sessions].sort((a, b) => {
    const aActive = a.stopped_at == null ? 0 : 1
    const bActive = b.stopped_at == null ? 0 : 1
    return aActive - bActive
  })

  const enriched: ProjectGoalWithLink[] = goals.map((g) => {
    const match = sorted.find((s) => intentMatchesGoal(g.text, s.intent))
    return {
      ...g,
      linkedSessionId: match?.id ?? null,
      linkedSessionSlug: match?.slug ?? null,
      linkedSessionIntent: match?.intent ?? null,
    }
  })

  return c.json({ goals: enriched })
})

router.put('/projects/:id/goals', async (c) => {
  const store = c.get('store')
  const broadcastToAll = c.get('broadcastToAll')
  const projectId = Number(c.req.param('id'))
  if (!Number.isFinite(projectId)) return apiError(c, 400, 'Invalid project ID')

  const project = await store.getProjectById(projectId)
  if (!project) return apiError(c, 404, 'Project not found')

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return apiError(c, 400, 'Invalid JSON body')
  }

  const incoming = (body as { goals?: unknown })?.goals
  if (!Array.isArray(incoming)) {
    return apiError(c, 400, 'goals must be an array')
  }
  if (incoming.length > MAX_GOALS) {
    return apiError(c, 400, `goals array exceeds max length of ${MAX_GOALS}`)
  }

  const seenIds = new Set<string>()
  const cleaned: ProjectGoal[] = []
  for (const raw of incoming) {
    if (!raw || typeof raw !== 'object') {
      return apiError(c, 400, 'each goal must be an object')
    }
    const r = raw as Record<string, unknown>
    const id = typeof r.id === 'string' ? r.id.trim() : ''
    const text = typeof r.text === 'string' ? r.text.trim() : ''
    const done = r.done === true
    if (!id) return apiError(c, 400, 'each goal must have a non-empty string id')
    if (seenIds.has(id)) return apiError(c, 400, `duplicate goal id: ${id}`)
    if (!text) return apiError(c, 400, 'each goal must have non-empty text')
    if (text.length > MAX_GOAL_TEXT_LEN) {
      return apiError(c, 400, `goal text exceeds max length of ${MAX_GOAL_TEXT_LEN}`)
    }
    seenIds.add(id)
    cleaned.push({ id, text, done })
  }

  await store.setProjectGoals(projectId, cleaned)
  broadcastToAll({ type: 'project_goals_update', data: { projectId } })
  return c.json({ ok: true })
})

export default router
