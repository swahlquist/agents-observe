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
    // Status-derivation path added in 01A-01 PLAN. Default to empty
    // events so routes still return a valid response when these
    // tests focus on other response fields.
    getRecentEventsForSession: vi.fn(),
  }

  beforeEach(async () => {
    vi.resetModules()
    Object.values(mockStore).forEach((fn) => fn.mockReset())
    mockStore.getRecentEventsForSession.mockResolvedValue([])

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
    // Status-derivation path added in 01A-01 PLAN. Default to empty
    // events; these tests assert intent fields, not derived status.
    getRecentEventsForSession: vi.fn(),
  }
  let lastBroadcast: any[] = []

  beforeEach(async () => {
    vi.resetModules()
    Object.values(mockStore).forEach((fn) => fn.mockReset())
    mockStore.getRecentEventsForSession.mockResolvedValue([])
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

// HOME-01 / HOME-02 / HOME-12: derived status + perf budget on the
// recent-sessions and single-session routes. Adversary mitigations
// exercised: C1 (DESC scan returns newest events, not oldest),
// New-H2 (skip per-row derivation when limit > DERIVED_LIMIT_THRESHOLD),
// Round 3 New-H (lastActivity coerced to started_at when null on wire).
describe('GET /api/sessions/recent: derived status fields and perf budget', () => {
  let app: Hono<Env>
  const mockStore = {
    getRecentSessions: vi.fn(),
    getSessionById: vi.fn(),
    getRecentEventsForSession: vi.fn(),
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

  test('every row carries the five new derived fields plus the legacy status field', async () => {
    mockStore.getRecentSessions.mockResolvedValue([
      {
        id: 'sess1',
        project_id: 1,
        project_name: 'P',
        project_slug: 'p',
        slug: null,
        started_at: 1000,
        stopped_at: null,
        last_activity: 1000,
        pending_notification_ts: null,
        metadata: null,
        agent_count: 0,
        event_count: 0,
        agent_classes: null,
      },
    ])
    mockStore.getRecentEventsForSession.mockResolvedValue([])

    const res = await app.request('/api/sessions/recent?limit=30')
    const body = await res.json()
    const row = body[0]
    // Legacy two-state status (unchanged).
    expect(row.status).toBe('active')
    // Five new HOME-01 fields present.
    expect(row).toHaveProperty('derivedStatus')
    expect(row).toHaveProperty('statusDetail')
    expect(row).toHaveProperty('needsYou')
    expect(row).toHaveProperty('lastActionLabel')
    expect(row).toHaveProperty('lastActionAt')
  })

  test('classifies WAITING_ON_PERMISSION from a real journal Notification string returned newest-first (C1 DESC regression)', async () => {
    // Mimic a session with >50 events whose newest event is a
    // permission Notification. The route asks for the newest 50
    // via getRecentEventsForSession (DESC); we return that newest
    // slice with the Notification at position 0.
    mockStore.getRecentSessions.mockResolvedValue([
      {
        id: 'sess1',
        project_id: 1,
        project_name: 'P',
        project_slug: 'p',
        slug: null,
        started_at: 1000,
        stopped_at: null,
        last_activity: 5000,
        pending_notification_ts: 5000,
        metadata: null,
        agent_count: 0,
        event_count: 0,
        agent_classes: null,
      },
    ])
    // Newest-first: position 0 is the most recent event.
    mockStore.getRecentEventsForSession.mockResolvedValue([
      {
        id: 999,
        agent_id: 'a',
        session_id: 'sess1',
        hook_name: 'Notification',
        timestamp: 5000,
        created_at: 5000,
        cwd: null,
        _meta: null,
        payload: JSON.stringify({ message: 'Claude needs your permission to use Bash' }),
      },
    ])

    const res = await app.request('/api/sessions/recent?limit=30')
    const body = await res.json()
    expect(body[0].derivedStatus).toBe('WAITING_ON_PERMISSION')
    expect(body[0].statusDetail).toBe('Bash')
    expect(body[0].needsYou).toBe(true)
    expect(body[0].status).toBe('active') // Legacy unchanged.
  })

  test('skips per-row derivation when limit > 50 (New-H2 mitigation)', async () => {
    // Seed 6 rows; limit=10000 should trigger the placeholder branch.
    // Use a fresh last_activity so the WR-01 recency cascade in the
    // placeholder lands on WORKING (within 60s window).
    const now = Date.now()
    const rows = Array.from({ length: 6 }, (_, i) => ({
      id: `sess${i}`,
      project_id: 1,
      project_name: 'P',
      project_slug: 'p',
      slug: null,
      started_at: now - 1_000,
      stopped_at: i === 5 ? now - 500 : null,
      last_activity: now - 1_000,
      pending_notification_ts: null,
      metadata: null,
      agent_count: 0,
      event_count: 0,
      agent_classes: null,
    }))
    mockStore.getRecentSessions.mockResolvedValue(rows)

    const res = await app.request('/api/sessions/recent?limit=10000')
    const body = await res.json()
    expect(body.length).toBe(6)
    expect(mockStore.getRecentEventsForSession).toHaveBeenCalledTimes(0)
    // Placeholders: WORKING for active rows (fresh last_activity),
    // FINISHED for the stopped row, other fields null/false.
    expect(body[0].derivedStatus).toBe('WORKING')
    expect(body[5].derivedStatus).toBe('FINISHED')
    expect(body[0].statusDetail).toBeNull()
    expect(body[0].needsYou).toBe(false)
    expect(body[0].lastActionLabel).toBeNull()
    expect(body[0].lastActionAt).toBeNull()
  })

  test('placeholder branch returns IDLE / ABANDONED for stale last_activity (WR-01)', async () => {
    // Pre-WR-01: every non-stopped row was stamped WORKING regardless of
    // recency, so consumers of derivedStatus on a high-limit endpoint saw
    // "Working" badges on idle and abandoned sessions. Now the placeholder
    // mirrors deriveStatus()'s recency cascade for non-Notification states.
    const now = Date.now()
    const rows = [
      // Fresh: within the 60s WORKING window.
      { id: 'sess-working', last_activity: now - 10_000, started_at: now - 60_000 },
      // 5 minutes idle: between 60s and 30min.
      { id: 'sess-idle', last_activity: now - 5 * 60_000, started_at: now - 6 * 60_000 },
      // 45 minutes idle: past the 30min ABANDONED cutoff.
      { id: 'sess-abandoned', last_activity: now - 45 * 60_000, started_at: now - 46 * 60_000 },
      // Null last_activity, fresh started_at: fall back to started_at,
      // still in WORKING window.
      { id: 'sess-null-fresh', last_activity: null, started_at: now - 30_000 },
    ].map((base) => ({
      project_id: 1,
      project_name: 'P',
      project_slug: 'p',
      slug: null,
      stopped_at: null,
      pending_notification_ts: null,
      metadata: null,
      agent_count: 0,
      event_count: 0,
      agent_classes: null,
      ...base,
    }))
    mockStore.getRecentSessions.mockResolvedValue(rows)

    const res = await app.request('/api/sessions/recent?limit=10000')
    const body = await res.json()
    const byId = new Map<string, { derivedStatus: string }>(
      body.map((row: { id: string; derivedStatus: string }) => [row.id, row]),
    )
    expect(byId.get('sess-working')?.derivedStatus).toBe('WORKING')
    expect(byId.get('sess-idle')?.derivedStatus).toBe('IDLE')
    expect(byId.get('sess-abandoned')?.derivedStatus).toBe('ABANDONED')
    expect(byId.get('sess-null-fresh')?.derivedStatus).toBe('WORKING')
    // Zero event lookups: still the placeholder fast path.
    expect(mockStore.getRecentEventsForSession).toHaveBeenCalledTimes(0)
  })

  test('performs full derivation when limit <= 50 (home view path)', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({
      id: `sess${i}`,
      project_id: 1,
      project_name: 'P',
      project_slug: 'p',
      slug: null,
      started_at: 1000,
      stopped_at: null,
      last_activity: 1000,
      pending_notification_ts: null,
      metadata: null,
      agent_count: 0,
      event_count: 0,
      agent_classes: null,
    }))
    mockStore.getRecentSessions.mockResolvedValue(rows)
    mockStore.getRecentEventsForSession.mockResolvedValue([])

    const res = await app.request('/api/sessions/recent?limit=30')
    expect(res.status).toBe(200)
    expect(mockStore.getRecentEventsForSession).toHaveBeenCalledTimes(3)
    // Each call is bounded at 50 events.
    for (const call of mockStore.getRecentEventsForSession.mock.calls) {
      expect(call[1]).toBe(50)
    }
  })

  test('wire-coerces null last_activity to started_at (Round 3 New-H mitigation)', async () => {
    mockStore.getRecentSessions.mockResolvedValue([
      {
        id: 'sess1',
        project_id: 1,
        project_name: 'P',
        project_slug: 'p',
        slug: null,
        started_at: 1_700_000_000_000,
        stopped_at: null,
        last_activity: null, // Just-cleared-events scenario.
        pending_notification_ts: null,
        metadata: null,
        agent_count: 0,
        event_count: 0,
        agent_classes: null,
      },
    ])
    mockStore.getRecentEventsForSession.mockResolvedValue([])

    const res = await app.request('/api/sessions/recent?limit=30')
    const body = await res.json()
    expect(body[0].lastActivity).toBe(1_700_000_000_000)
    expect(body[0].lastActivity).not.toBeNull()
  })

  test('preserves real last_activity when it is set (no spurious coercion)', async () => {
    mockStore.getRecentSessions.mockResolvedValue([
      {
        id: 'sess1',
        project_id: 1,
        project_name: 'P',
        project_slug: 'p',
        slug: null,
        started_at: 1_700_000_000_000,
        stopped_at: null,
        last_activity: 1_700_001_000_000,
        pending_notification_ts: null,
        metadata: null,
        agent_count: 0,
        event_count: 0,
        agent_classes: null,
      },
    ])
    mockStore.getRecentEventsForSession.mockResolvedValue([])

    const res = await app.request('/api/sessions/recent?limit=30')
    const body = await res.json()
    expect(body[0].lastActivity).toBe(1_700_001_000_000)
  })

  test('WR-05: malformed ?limit=abc falls back to default and does not crash', async () => {
    // Pre-WR-05: parseInt('abc') returned NaN; the limit > 50 check
    // was false for NaN so it fell into full derivation, and NaN was
    // bound into the SQL prepared statement which better-sqlite3
    // rejects, surfacing as a 500. Now we strict-parse digits-only
    // and fall back to the default of 20.
    mockStore.getRecentSessions.mockResolvedValue([])

    const res = await app.request('/api/sessions/recent?limit=abc')
    expect(res.status).toBe(200)
    // Default fallback of 20 reached the storage layer.
    expect(mockStore.getRecentSessions).toHaveBeenCalledWith(20)
  })

  test('WR-05: malformed ?limit=10abc rejects mixed input and falls back', async () => {
    mockStore.getRecentSessions.mockResolvedValue([])
    const res = await app.request('/api/sessions/recent?limit=10abc')
    expect(res.status).toBe(200)
    // Strict parse rejects mixed strings (not just 10).
    expect(mockStore.getRecentSessions).toHaveBeenCalledWith(20)
  })

  test('WR-05: negative/zero ?limit falls back to default', async () => {
    mockStore.getRecentSessions.mockResolvedValue([])
    const res1 = await app.request('/api/sessions/recent?limit=-5')
    expect(res1.status).toBe(200)
    expect(mockStore.getRecentSessions).toHaveBeenCalledWith(20)
    mockStore.getRecentSessions.mockClear()
    const res2 = await app.request('/api/sessions/recent?limit=0')
    expect(res2.status).toBe(200)
    expect(mockStore.getRecentSessions).toHaveBeenCalledWith(20)
  })
})

describe('GET /api/sessions/:id: derived status fields', () => {
  let app: Hono<Env>
  const mockStore = {
    getSessionById: vi.fn(),
    getRecentEventsForSession: vi.fn(),
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

  test('single-session response carries the five new derived fields and legacy status', async () => {
    mockStore.getSessionById.mockResolvedValue({
      id: 'sess1',
      project_id: 1,
      project_name: 'P',
      project_slug: 'p',
      slug: null,
      started_at: 1000,
      stopped_at: null,
      last_activity: 1000,
      pending_notification_ts: null,
      transcript_path: null,
      metadata: null,
      agent_count: 0,
      event_count: 0,
      agent_classes: null,
    })
    mockStore.getRecentEventsForSession.mockResolvedValue([])

    const res = await app.request('/api/sessions/sess1')
    const body = await res.json()
    expect(body.status).toBe('active') // Legacy.
    expect(body).toHaveProperty('derivedStatus')
    expect(body).toHaveProperty('statusDetail')
    expect(body).toHaveProperty('needsYou')
    expect(body).toHaveProperty('lastActionLabel')
    expect(body).toHaveProperty('lastActionAt')
    // Cost is 1 + 1.
    expect(mockStore.getRecentEventsForSession).toHaveBeenCalledTimes(1)
  })

  test('single-session response coerces null last_activity to started_at on the wire', async () => {
    mockStore.getSessionById.mockResolvedValue({
      id: 'sess1',
      project_id: 1,
      project_name: 'P',
      project_slug: 'p',
      slug: null,
      started_at: 1_700_000_000_000,
      stopped_at: null,
      last_activity: null,
      pending_notification_ts: null,
      transcript_path: null,
      metadata: null,
      agent_count: 0,
      event_count: 0,
      agent_classes: null,
    })
    mockStore.getRecentEventsForSession.mockResolvedValue([])

    const res = await app.request('/api/sessions/sess1')
    const body = await res.json()
    expect(body.lastActivity).toBe(1_700_000_000_000)
  })
})
