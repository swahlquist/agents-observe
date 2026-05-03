import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest'
import { Hono } from 'hono'
import { SqliteAdapter } from '../storage/sqlite-adapter'
import type { EventStore } from '../storage/types'

type Env = { Variables: { store: EventStore } }

let store: SqliteAdapter
let app: Hono<Env>

beforeEach(async () => {
  store = new SqliteAdapter(':memory:')
  const { default: router } = await import('./overlaps')
  app = new Hono<Env>()
  app.use('*', async (c, next) => {
    c.set('store', store as unknown as EventStore)
    await next()
  })
  app.route('/api', router)
})

afterEach(() => {
  vi.useRealTimers()
})

async function seedPair(opts: {
  sessionA: string
  sessionB: string
  filePath: string
  aTouchedAt: number
  bTouchedAt: number
  aToolName?: string
  bToolName?: string
}) {
  const projectId = await store.createProject('p', 'P')
  await store.upsertSession(opts.sessionA, projectId, null, null, 1000)
  await store.upsertSession(opts.sessionB, projectId, null, null, 1000)
  await store.recordFileTouch({
    sessionId: opts.sessionA,
    filePath: opts.filePath,
    toolName: opts.aToolName ?? 'Edit',
    touchedAt: opts.aTouchedAt,
  })
  await store.recordFileTouch({
    sessionId: opts.sessionB,
    filePath: opts.filePath,
    toolName: opts.bToolName ?? 'Read',
    touchedAt: opts.bTouchedAt,
  })
}

describe('GET /api/overlaps', () => {
  test('empty database returns empty pairs and the default 30-min window', async () => {
    const res = await app.request('/api/overlaps')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { windowMs: number; pairs: unknown[] }
    expect(body.windowMs).toBe(30 * 60 * 1000)
    expect(body.pairs).toEqual([])
  })

  test('returns one pair-grouped row when two active sessions touch the same file', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    await seedPair({
      sessionA: 'sA',
      sessionB: 'sB',
      filePath: '/repo/foo.ts',
      aTouchedAt: 8000,
      bTouchedAt: 9000,
      aToolName: 'Edit',
      bToolName: 'Read',
    })
    const res = await app.request('/api/overlaps')
    const body = (await res.json()) as {
      pairs: Array<{
        sessionA: string
        sessionB: string
        files: Array<{ filePath: string; aToolName: string; bToolName: string }>
        lastTouchedAt: number
      }>
    }
    expect(body.pairs).toHaveLength(1)
    expect(body.pairs[0]).toMatchObject({
      sessionA: 'sA',
      sessionB: 'sB',
      lastTouchedAt: 9000,
    })
    expect(body.pairs[0].files).toEqual([
      {
        filePath: '/repo/foo.ts',
        aTouchedAt: 8000,
        bTouchedAt: 9000,
        aToolName: 'Edit',
        bToolName: 'Read',
      },
    ])
  })

  test('enriches each pair with intent, slug, and projectId for both sessions', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    const projectAId = await store.createProject('p-a', 'Project A')
    const projectBId = await store.createProject('p-b', 'Project B')
    await store.upsertSession('sA', projectAId, 'twinkly-dragon', null, 1000)
    await store.upsertSession('sB', projectBId, 'happy-otter', null, 1000)
    await store.updateSessionIntent('sA', 'Refactor symbol search', 'manual')
    await store.updateSessionIntent('sB', 'Auth middleware cleanup', 'auto')
    await store.recordFileTouch({
      sessionId: 'sA',
      filePath: '/repo/foo.ts',
      toolName: 'Edit',
      touchedAt: 8000,
    })
    await store.recordFileTouch({
      sessionId: 'sB',
      filePath: '/repo/foo.ts',
      toolName: 'Read',
      touchedAt: 9000,
    })
    const res = await app.request('/api/overlaps')
    const body = (await res.json()) as { pairs: Array<Record<string, unknown>> }
    expect(body.pairs[0]).toMatchObject({
      sessionA: 'sA',
      sessionAIntent: 'Refactor symbol search',
      sessionAIntentSource: 'manual',
      sessionASlug: 'twinkly-dragon',
      sessionAProjectId: projectAId,
      sessionB: 'sB',
      sessionBIntent: 'Auth middleware cleanup',
      sessionBIntentSource: 'auto',
      sessionBSlug: 'happy-otter',
      sessionBProjectId: projectBId,
    })
  })

  test('groups multiple shared files under the same session pair', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    const projectId = await store.createProject('p', 'P')
    await store.upsertSession('sA', projectId, null, null, 1000)
    await store.upsertSession('sB', projectId, null, null, 1000)
    for (const f of ['/foo.ts', '/bar.ts', '/baz.ts']) {
      await store.recordFileTouch({
        sessionId: 'sA',
        filePath: f,
        toolName: 'Edit',
        touchedAt: 8000,
      })
      await store.recordFileTouch({
        sessionId: 'sB',
        filePath: f,
        toolName: 'Read',
        touchedAt: 9000,
      })
    }
    const res = await app.request('/api/overlaps')
    const body = (await res.json()) as { pairs: Array<{ files: Array<{ filePath: string }> }> }
    expect(body.pairs).toHaveLength(1)
    expect(body.pairs[0].files.map((f) => f.filePath).sort()).toEqual([
      '/bar.ts',
      '/baz.ts',
      '/foo.ts',
    ])
  })

  test('respects a custom windowMs query parameter', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    // Both touches happen 9 seconds before "now". A 5s window should
    // exclude them; a 30s window should include them.
    await seedPair({
      sessionA: 'sA',
      sessionB: 'sB',
      filePath: '/repo/foo.ts',
      aTouchedAt: 1000,
      bTouchedAt: 1500,
    })
    const tight = await app.request('/api/overlaps?windowMs=5000')
    const tightBody = (await tight.json()) as { pairs: unknown[] }
    expect(tightBody.pairs).toEqual([])

    const loose = await app.request('/api/overlaps?windowMs=30000')
    const looseBody = (await loose.json()) as { pairs: unknown[] }
    expect(looseBody.pairs).toHaveLength(1)
  })

  test('400s on a non-positive windowMs', async () => {
    const zero = await app.request('/api/overlaps?windowMs=0')
    expect(zero.status).toBe(400)
    const negative = await app.request('/api/overlaps?windowMs=-1')
    expect(negative.status).toBe(400)
    const garbage = await app.request('/api/overlaps?windowMs=not-a-number')
    expect(garbage.status).toBe(400)
  })

  test('clamps oversized windowMs to 24h', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    const res = await app.request('/api/overlaps?windowMs=999999999999')
    const body = (await res.json()) as { windowMs: number }
    expect(body.windowMs).toBe(24 * 60 * 60 * 1000)
  })

  test('excludes pairs where one session is stopped', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    await seedPair({
      sessionA: 'sA',
      sessionB: 'sB',
      filePath: '/repo/foo.ts',
      aTouchedAt: 8000,
      bTouchedAt: 9000,
    })
    await store.stopSession('sB', 9500)
    const res = await app.request('/api/overlaps')
    const body = (await res.json()) as { pairs: unknown[] }
    expect(body.pairs).toEqual([])
  })

  test('orders pairs by most recent overlap activity first', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(20_000)
    const projectId = await store.createProject('p', 'P')
    await store.upsertSession('sA', projectId, null, null, 1000)
    await store.upsertSession('sB', projectId, null, null, 1000)
    await store.upsertSession('sC', projectId, null, null, 1000)
    await store.upsertSession('sD', projectId, null, null, 1000)
    // Older overlap pair (A,B)
    await store.recordFileTouch({
      sessionId: 'sA',
      filePath: '/old.ts',
      toolName: 'Edit',
      touchedAt: 5000,
    })
    await store.recordFileTouch({
      sessionId: 'sB',
      filePath: '/old.ts',
      toolName: 'Read',
      touchedAt: 5500,
    })
    // Newer overlap pair (C,D)
    await store.recordFileTouch({
      sessionId: 'sC',
      filePath: '/new.ts',
      toolName: 'Edit',
      touchedAt: 18000,
    })
    await store.recordFileTouch({
      sessionId: 'sD',
      filePath: '/new.ts',
      toolName: 'Read',
      touchedAt: 19000,
    })
    const res = await app.request('/api/overlaps')
    const body = (await res.json()) as { pairs: Array<{ sessionA: string; sessionB: string }> }
    expect(body.pairs.map((p) => `${p.sessionA}-${p.sessionB}`)).toEqual(['sC-sD', 'sA-sB'])
  })
})
