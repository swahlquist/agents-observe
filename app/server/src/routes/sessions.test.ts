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

describe('session routes — agentClasses response shape', () => {
  let app: Hono<Env>
  const mockStore = {
    getRecentSessions: vi.fn(),
    getSessionById: vi.fn(),
  }

  beforeEach(async () => {
    vi.resetModules()
    Object.values(mockStore).forEach((fn) => fn.mockReset())

    vi.doMock('../config', () => ({
      config: { logLevel: 'error' },
    }))

    const { default: sessionsRouter } = await import('./sessions')
    app = new Hono<Env>()
    app.use('*', async (c, next) => {
      c.set('store', mockStore as unknown as EventStore)
      c.set('broadcastToSession', () => {})
      c.set('broadcastToAll', () => {})
      await next()
    })
    app.route('/api', sessionsRouter)
  })

  test('GET /api/sessions/recent splits comma-joined agent_classes into an array', async () => {
    mockStore.getRecentSessions.mockResolvedValue([
      {
        id: 'sess1',
        project_id: 1,
        project_name: 'P',
        project_slug: 'p',
        slug: null,
        status: 'active',
        started_at: 1000,
        stopped_at: null,
        metadata: null,
        agent_count: 2,
        event_count: 0,
        last_activity: 2000,
        agent_classes: 'claude-code,codex',
      },
    ])

    const res = await app.request('/api/sessions/recent')
    const body = await res.json()
    expect(body[0].agentClasses).toEqual(['claude-code', 'codex'])
  })

  test('GET /api/sessions/recent returns empty array when agent_classes is null', async () => {
    mockStore.getRecentSessions.mockResolvedValue([
      {
        id: 'sess1',
        project_id: 1,
        project_name: 'P',
        project_slug: 'p',
        slug: null,
        status: 'active',
        started_at: 1000,
        stopped_at: null,
        metadata: null,
        agent_count: 0,
        event_count: 0,
        last_activity: 1000,
        agent_classes: null,
      },
    ])

    const res = await app.request('/api/sessions/recent')
    const body = await res.json()
    expect(body[0].agentClasses).toEqual([])
  })

  test('GET /api/sessions/:id splits comma-joined agent_classes into an array', async () => {
    mockStore.getSessionById.mockResolvedValue({
      id: 'sess1',
      project_id: 1,
      project_name: 'P',
      project_slug: 'p',
      slug: null,
      status: 'active',
      started_at: 1000,
      stopped_at: null,
      transcript_path: null,
      metadata: null,
      agent_count: 2,
      event_count: 0,
      last_activity: 2000,
      agent_classes: 'claude-code,codex',
    })

    const res = await app.request('/api/sessions/sess1')
    const body = await res.json()
    expect(body.agentClasses).toEqual(['claude-code', 'codex'])
  })

  test('GET /api/sessions/:id returns empty array when no agents have a class', async () => {
    mockStore.getSessionById.mockResolvedValue({
      id: 'sess1',
      project_id: 1,
      project_name: 'P',
      project_slug: 'p',
      slug: null,
      status: 'active',
      started_at: 1000,
      stopped_at: null,
      transcript_path: null,
      metadata: null,
      agent_count: 0,
      event_count: 0,
      last_activity: 1000,
      agent_classes: null,
    })

    const res = await app.request('/api/sessions/sess1')
    const body = await res.json()
    expect(body.agentClasses).toEqual([])
  })
})

describe('GET /api/sessions/:id/events — fields= allow-list', () => {
  let app: Hono<Env>
  const mockStore = {
    getEventsForSession: vi.fn(),
    getEventsSince: vi.fn(),
    getSessionById: vi.fn(),
    updateSessionStatus: vi.fn(),
  }

  beforeEach(async () => {
    vi.resetModules()
    Object.values(mockStore).forEach((fn) => fn.mockReset())
    vi.doMock('../config', () => ({ config: { logLevel: 'error' } }))
    const { default: sessionsRouter } = await import('./sessions')
    app = new Hono<Env>()
    app.use('*', async (c, next) => {
      c.set('store', mockStore as unknown as EventStore)
      c.set('broadcastToSession', () => {})
      c.set('broadcastToAll', () => {})
      await next()
    })
    app.route('/api', sessionsRouter)
  })

  test('default response omits sessionId, cwd, createdAt, _meta', async () => {
    mockStore.getEventsForSession.mockResolvedValue([
      {
        id: 1,
        agent_id: 'agent-1',
        session_id: 'sess-1',
        hook_name: 'PreToolUse',
        timestamp: 1000,
        created_at: 2000,
        cwd: '/tmp',
        _meta: '{"foo":"bar"}',
        payload: '{"x":1}',
      },
    ])
    mockStore.getSessionById.mockResolvedValue({ stopped_at: null })

    const res = await app.request('/api/sessions/sess-1/events')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual([
      { id: 1, agentId: 'agent-1', hookName: 'PreToolUse', timestamp: 1000, payload: { x: 1 } },
    ])
    expect(body[0]).not.toHaveProperty('sessionId')
    expect(body[0]).not.toHaveProperty('cwd')
    expect(body[0]).not.toHaveProperty('createdAt')
    expect(body[0]).not.toHaveProperty('_meta')
  })

  test('fields=sessionId,cwd,createdAt,_meta returns the opt-in fields', async () => {
    mockStore.getEventsForSession.mockResolvedValue([
      {
        id: 1,
        agent_id: 'agent-1',
        session_id: 'sess-1',
        hook_name: 'PreToolUse',
        timestamp: 1000,
        created_at: 2000,
        cwd: '/tmp',
        _meta: '{"foo":"bar"}',
        payload: '{"x":1}',
      },
    ])
    mockStore.getSessionById.mockResolvedValue({ stopped_at: null })

    const res = await app.request(
      '/api/sessions/sess-1/events?fields=sessionId,cwd,createdAt,_meta',
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual([
      {
        id: 1,
        agentId: 'agent-1',
        hookName: 'PreToolUse',
        timestamp: 1000,
        payload: { x: 1 },
        sessionId: 'sess-1',
        cwd: '/tmp',
        createdAt: 2000,
        _meta: { foo: 'bar' },
      },
    ])
  })

  test('unknown fields in fields= are ignored', async () => {
    mockStore.getEventsForSession.mockResolvedValue([
      {
        id: 1,
        agent_id: 'agent-1',
        session_id: 'sess-1',
        hook_name: 'PreToolUse',
        timestamp: 1000,
        created_at: 2000,
        cwd: '/tmp',
        _meta: null,
        payload: '{}',
      },
    ])
    mockStore.getSessionById.mockResolvedValue({ stopped_at: null })

    const res = await app.request('/api/sessions/sess-1/events?fields=cwd,bogus,createdAt')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body[0]).toHaveProperty('cwd', '/tmp')
    expect(body[0]).toHaveProperty('createdAt', 2000)
    expect(body[0]).not.toHaveProperty('sessionId')
    expect(body[0]).not.toHaveProperty('_meta')
    expect(body[0]).not.toHaveProperty('bogus')
  })
})

describe('session intent — read + write', () => {
  let app: Hono<Env>
  const mockStore = {
    getRecentSessions: vi.fn(),
    getSessionById: vi.fn(),
    updateSessionIntent: vi.fn(),
    updateSessionSlug: vi.fn(),
    updateSessionProject: vi.fn(),
  }
  let lastBroadcast: any[] = []

  beforeEach(async () => {
    vi.resetModules()
    Object.values(mockStore).forEach((fn) => fn.mockReset())
    lastBroadcast = []

    vi.doMock('../config', () => ({ config: { logLevel: 'error' } }))
    const { default: sessionsRouter } = await import('./sessions')
    app = new Hono<Env>()
    app.use('*', async (c, next) => {
      c.set('store', mockStore as unknown as EventStore)
      c.set('broadcastToSession', () => {})
      c.set('broadcastToAll', (msg: any) => lastBroadcast.push(msg))
      await next()
    })
    app.route('/api', sessionsRouter)
  })

  test('GET /api/sessions/recent surfaces intent + intentSource', async () => {
    mockStore.getRecentSessions.mockResolvedValue([
      {
        id: 'sess1',
        project_id: 1,
        project_name: 'P',
        project_slug: 'p',
        slug: 'twinkly-dragon',
        intent: 'Refactor symbol search',
        intent_source: 'manual',
        status: 'active',
        started_at: 1000,
        stopped_at: null,
        metadata: null,
        agent_count: 1,
        event_count: 0,
        last_activity: 2000,
        agent_classes: 'claude-code',
      },
    ])

    const res = await app.request('/api/sessions/recent')
    const body = await res.json()
    expect(body[0].intent).toBe('Refactor symbol search')
    expect(body[0].intentSource).toBe('manual')
  })

  test('GET /api/sessions/recent normalizes missing intent fields to null', async () => {
    mockStore.getRecentSessions.mockResolvedValue([
      {
        id: 'sess1',
        project_id: 1,
        project_name: 'P',
        project_slug: 'p',
        slug: 'twinkly-dragon',
        // intent + intent_source absent (legacy session before migration)
        status: 'active',
        started_at: 1000,
        stopped_at: null,
        metadata: null,
        agent_count: 0,
        event_count: 0,
        last_activity: 1000,
        agent_classes: null,
      },
    ])

    const res = await app.request('/api/sessions/recent')
    const body = await res.json()
    expect(body[0].intent).toBeNull()
    expect(body[0].intentSource).toBeNull()
  })

  test('PATCH /api/sessions/:id with intent calls updateSessionIntent (manual)', async () => {
    mockStore.getSessionById.mockResolvedValue({
      intent: 'Refactor symbol search',
      intent_source: 'manual',
    })
    mockStore.updateSessionIntent.mockResolvedValue(undefined)

    const res = await app.request('/api/sessions/sess1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intent: 'Refactor symbol search' }),
    })
    expect(res.status).toBe(200)
    expect(mockStore.updateSessionIntent).toHaveBeenCalledWith(
      'sess1',
      'Refactor symbol search',
      'manual',
    )
    const updateMsgs = lastBroadcast.filter((m) => m.type === 'session_update')
    expect(updateMsgs.length).toBeGreaterThan(0)
    expect(updateMsgs[0].data).toMatchObject({
      id: 'sess1',
      intent: 'Refactor symbol search',
      intentSource: 'manual',
    })
  })

  test('PATCH /api/sessions/:id with empty intent clears it (null)', async () => {
    mockStore.getSessionById.mockResolvedValue({ intent: null, intent_source: null })
    mockStore.updateSessionIntent.mockResolvedValue(undefined)

    const res = await app.request('/api/sessions/sess1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intent: '' }),
    })
    expect(res.status).toBe(200)
    expect(mockStore.updateSessionIntent).toHaveBeenCalledWith('sess1', null, 'manual')
  })

  test('PATCH /api/sessions/:id honors intentSource=auto when supplied', async () => {
    mockStore.getSessionById.mockResolvedValue({ intent: 'snippet', intent_source: 'auto' })
    mockStore.updateSessionIntent.mockResolvedValue(undefined)

    const res = await app.request('/api/sessions/sess1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intent: 'snippet', intentSource: 'auto' }),
    })
    expect(res.status).toBe(200)
    expect(mockStore.updateSessionIntent).toHaveBeenCalledWith('sess1', 'snippet', 'auto')
  })

  test('PATCH /api/sessions/:id caps intent at 200 chars', async () => {
    mockStore.getSessionById.mockResolvedValue({ intent: '...', intent_source: 'manual' })
    mockStore.updateSessionIntent.mockResolvedValue(undefined)

    const longText = 'x'.repeat(500)
    const res = await app.request('/api/sessions/sess1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intent: longText }),
    })
    expect(res.status).toBe(200)
    const callArgs = mockStore.updateSessionIntent.mock.calls[0]
    expect(callArgs[1].length).toBe(200)
  })
})
