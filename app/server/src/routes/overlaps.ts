import { Hono } from 'hono'
import type { EventStore, OverlapRow } from '../storage/types'
import { apiError } from '../errors'

type Env = {
  Variables: {
    store: EventStore
  }
}

const router = new Hono<Env>()

const DEFAULT_WINDOW_MS = 30 * 60 * 1000 // 30 minutes
const MAX_WINDOW_MS = 24 * 60 * 60 * 1000 // 24 hours

// Group raw pair-rows by (sessionA, sessionB) so the client gets one
// banner per session pair listing every shared file. Within a pair,
// files are ordered by most recent touch first. Each pair is enriched
// with the intent/slug/projectId of both sessions so the banner can
// render meaningful labels without a second round trip.
interface PairFile {
  filePath: string
  aTouchedAt: number
  bTouchedAt: number
  aToolName: string
  bToolName: string
}
interface OverlapPair {
  sessionA: string
  sessionAIntent: string | null
  sessionAIntentSource: 'manual' | 'auto' | null
  sessionASlug: string | null
  sessionAProjectId: number | null
  sessionB: string
  sessionBIntent: string | null
  sessionBIntentSource: 'manual' | 'auto' | null
  sessionBSlug: string | null
  sessionBProjectId: number | null
  files: PairFile[]
  lastTouchedAt: number
}

interface SessionLabel {
  intent: string | null
  intentSource: 'manual' | 'auto' | null
  slug: string | null
  projectId: number | null
}

async function loadSessionLabels(
  store: EventStore,
  sessionIds: Set<string>,
): Promise<Map<string, SessionLabel>> {
  const out = new Map<string, SessionLabel>()
  for (const id of sessionIds) {
    const row = await store.getSessionById(id)
    out.set(id, {
      intent: row?.intent ?? null,
      intentSource: (row?.intent_source as 'manual' | 'auto' | null) ?? null,
      slug: row?.slug ?? null,
      projectId: row?.project_id ?? null,
    })
  }
  return out
}

function groupByPair(rows: OverlapRow[], labels: Map<string, SessionLabel>): OverlapPair[] {
  const byKey = new Map<string, OverlapPair>()
  for (const r of rows) {
    const key = `${r.sessionA}|${r.sessionB}`
    let pair = byKey.get(key)
    if (!pair) {
      const a = labels.get(r.sessionA)
      const b = labels.get(r.sessionB)
      pair = {
        sessionA: r.sessionA,
        sessionAIntent: a?.intent ?? null,
        sessionAIntentSource: a?.intentSource ?? null,
        sessionASlug: a?.slug ?? null,
        sessionAProjectId: a?.projectId ?? null,
        sessionB: r.sessionB,
        sessionBIntent: b?.intent ?? null,
        sessionBIntentSource: b?.intentSource ?? null,
        sessionBSlug: b?.slug ?? null,
        sessionBProjectId: b?.projectId ?? null,
        files: [],
        lastTouchedAt: 0,
      }
      byKey.set(key, pair)
    }
    pair.files.push({
      filePath: r.filePath,
      aTouchedAt: r.aTouchedAt,
      bTouchedAt: r.bTouchedAt,
      aToolName: r.aToolName,
      bToolName: r.bToolName,
    })
    const fileLast = Math.max(r.aTouchedAt, r.bTouchedAt)
    if (fileLast > pair.lastTouchedAt) pair.lastTouchedAt = fileLast
  }
  for (const pair of byKey.values()) {
    pair.files.sort(
      (a, b) => Math.max(b.aTouchedAt, b.bTouchedAt) - Math.max(a.aTouchedAt, a.bTouchedAt),
    )
  }
  return [...byKey.values()].sort((a, b) => b.lastTouchedAt - a.lastTouchedAt)
}

// GET /overlaps?windowMs=<ms>
// Returns active session pairs that have touched the same file within
// the lookback window (default 30 min, capped at 24 h to bound the
// query). Pairs are deduplicated and grouped per session pair so each
// "tabs N and M are both editing X, Y" banner is one row.
router.get('/overlaps', async (c) => {
  const store = c.get('store')
  const raw = c.req.query('windowMs')
  const parsed = raw == null ? DEFAULT_WINDOW_MS : Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return apiError(c, 400, 'windowMs must be a positive number of milliseconds')
  }
  const windowMs = Math.min(parsed, MAX_WINDOW_MS)
  const since = Date.now() - windowMs
  const rows = await store.findOverlappingSessions(since)
  const sessionIds = new Set<string>()
  for (const r of rows) {
    sessionIds.add(r.sessionA)
    sessionIds.add(r.sessionB)
  }
  const labels = await loadSessionLabels(store, sessionIds)
  return c.json({
    windowMs,
    since,
    pairs: groupByPair(rows, labels),
  })
})

export default router
