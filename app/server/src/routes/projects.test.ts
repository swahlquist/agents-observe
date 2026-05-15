// app/server/src/routes/projects.test.ts
//
// HOME-01 / Round 4 Medium: /projects/:id/sessions emits the same
// coerced lastActivity as /sessions/recent. Before this change, a
// session whose events were cleared via clearSessionEvents emitted
// lastActivity: null here while emitting lastActivity: <started_at>
// on /sessions/recent. After this change both endpoints agree.

import { describe, test, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { EventStore } from '../storage/types'

type Env = {
  Variables: {
    store: EventStore
    broadcastToSession: (sessionId: string, msg: object) => void
    broadcastToAll: (msg: object) => void
  }
}

describe('GET /api/projects/:id/sessions lastActivity wire coercion', () => {
  let app: Hono<Env>
  const mockStore = {
    getSessionsForProject: vi.fn(),
  }

  beforeEach(async () => {
    vi.resetModules()
    Object.values(mockStore).forEach((fn) => fn.mockReset())
    vi.doMock('../config', () => ({ config: { logLevel: 'error' } }))
    const { default: projectsRouter } = await import('./projects')
    app = new Hono<Env>()
    app.use('*', async (c, next) => {
      c.set('store', mockStore as unknown as EventStore)
      c.set('broadcastToSession', () => {})
      c.set('broadcastToAll', () => {})
      await next()
    })
    app.route('/api', projectsRouter)
  })

  test('emits started_at when last_activity is null (parity with /sessions/recent)', async () => {
    mockStore.getSessionsForProject.mockResolvedValue([
      {
        id: 'sess1',
        project_id: 7,
        slug: null,
        started_at: 1_700_000_000_000,
        stopped_at: null,
        last_activity: null, // Just-cleared scenario.
        transcript_path: null,
        start_cwd: null,
        metadata: null,
        agent_count: 0,
        event_count: 0,
        agent_classes: null,
      },
    ])

    const res = await app.request('/api/projects/7/sessions')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body[0].lastActivity).toBe(1_700_000_000_000)
    expect(body[0].lastActivity).not.toBeNull()
  })

  test('preserves real last_activity when set', async () => {
    mockStore.getSessionsForProject.mockResolvedValue([
      {
        id: 'sess1',
        project_id: 7,
        slug: null,
        started_at: 1_700_000_000_000,
        stopped_at: null,
        last_activity: 1_700_001_000_000,
        transcript_path: null,
        start_cwd: null,
        metadata: null,
        agent_count: 0,
        event_count: 0,
        agent_classes: null,
      },
    ])

    const res = await app.request('/api/projects/7/sessions')
    const body = await res.json()
    expect(body[0].lastActivity).toBe(1_700_001_000_000)
  })
})
