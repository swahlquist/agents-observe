import { describe, test, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { SqliteAdapter } from '../storage/sqlite-adapter'
import type { EventStore } from '../storage/types'

type Env = {
  Variables: {
    store: EventStore
    broadcastToAll: (msg: object) => void
  }
}

let store: SqliteAdapter
let app: Hono<Env>
let broadcasts: object[]

beforeEach(async () => {
  store = new SqliteAdapter(':memory:')
  broadcasts = []
  const { default: router } = await import('./goals')
  app = new Hono<Env>()
  app.use('*', async (c, next) => {
    c.set('store', store as unknown as EventStore)
    c.set('broadcastToAll', (msg: object) => {
      broadcasts.push(msg)
    })
    await next()
  })
  app.route('/api', router)
})

describe('GET /api/projects/:id/goals', () => {
  test('returns empty list for a project with no goals', async () => {
    const projectId = await store.createProject('p', 'P')
    const res = await app.request(`/api/projects/${projectId}/goals`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ goals: [] })
  })

  test('404s for a missing project', async () => {
    const res = await app.request('/api/projects/999/goals')
    expect(res.status).toBe(404)
  })

  test('400s on a non-numeric id', async () => {
    const res = await app.request('/api/projects/abc/goals')
    expect(res.status).toBe(400)
  })

  test('returns goals with null link when no session intent matches', async () => {
    const projectId = await store.createProject('p', 'P')
    await store.setProjectGoals(projectId, [{ id: 'g1', text: 'Refactor auth', done: false }])
    const res = await app.request(`/api/projects/${projectId}/goals`)
    const body = (await res.json()) as { goals: Array<Record<string, unknown>> }
    expect(body.goals[0]).toMatchObject({
      id: 'g1',
      text: 'Refactor auth',
      done: false,
      linkedSessionId: null,
      linkedSessionSlug: null,
      linkedSessionIntent: null,
    })
  })

  test('auto-links a goal to a session whose intent contains the goal text', async () => {
    const projectId = await store.createProject('p', 'P')
    await store.upsertSession('sA', projectId, 'twinkly-dragon', null, 1000)
    await store.updateSessionIntent('sA', 'Refactor auth middleware to use JWT', 'auto')
    await store.setProjectGoals(projectId, [{ id: 'g1', text: 'Refactor auth', done: false }])
    const res = await app.request(`/api/projects/${projectId}/goals`)
    const body = (await res.json()) as { goals: Array<Record<string, unknown>> }
    expect(body.goals[0]).toMatchObject({
      id: 'g1',
      linkedSessionId: 'sA',
      linkedSessionSlug: 'twinkly-dragon',
      linkedSessionIntent: 'Refactor auth middleware to use JWT',
    })
  })

  test('auto-link is case-insensitive', async () => {
    const projectId = await store.createProject('p', 'P')
    await store.upsertSession('sA', projectId, 'sa', null, 1000)
    await store.updateSessionIntent('sA', 'REFACTOR THE AUTH LAYER', 'manual')
    await store.setProjectGoals(projectId, [{ id: 'g1', text: 'refactor the auth', done: false }])
    const res = await app.request(`/api/projects/${projectId}/goals`)
    const body = (await res.json()) as { goals: Array<Record<string, unknown>> }
    expect(body.goals[0].linkedSessionId).toBe('sA')
  })

  test('auto-link does not fire for goals shorter than 4 chars', async () => {
    const projectId = await store.createProject('p', 'P')
    await store.upsertSession('sA', projectId, 'sa', null, 1000)
    await store.updateSessionIntent('sA', 'fix the build', 'auto')
    await store.setProjectGoals(projectId, [{ id: 'g1', text: 'fix', done: false }])
    const res = await app.request(`/api/projects/${projectId}/goals`)
    const body = (await res.json()) as { goals: Array<Record<string, unknown>> }
    expect(body.goals[0].linkedSessionId).toBeNull()
  })

  test('prefers an active session over a stopped one when both match', async () => {
    const projectId = await store.createProject('p', 'P')
    await store.upsertSession('sStopped', projectId, 'old-session', null, 1000)
    await store.upsertSession('sActive', projectId, 'new-session', null, 2000)
    await store.updateSessionIntent('sStopped', 'Refactor the auth layer', 'auto')
    await store.updateSessionIntent('sActive', 'Refactor the auth layer', 'manual')
    await store.stopSession('sStopped', 1500)
    await store.setProjectGoals(projectId, [
      { id: 'g1', text: 'Refactor the auth layer', done: false },
    ])
    const res = await app.request(`/api/projects/${projectId}/goals`)
    const body = (await res.json()) as { goals: Array<Record<string, unknown>> }
    expect(body.goals[0].linkedSessionId).toBe('sActive')
  })

  test('does not match across projects', async () => {
    const pA = await store.createProject('a', 'A')
    const pB = await store.createProject('b', 'B')
    await store.upsertSession('sB', pB, 'sb', null, 1000)
    await store.updateSessionIntent('sB', 'Refactor auth middleware', 'manual')
    await store.setProjectGoals(pA, [{ id: 'g1', text: 'Refactor auth', done: false }])
    const res = await app.request(`/api/projects/${pA}/goals`)
    const body = (await res.json()) as { goals: Array<Record<string, unknown>> }
    expect(body.goals[0].linkedSessionId).toBeNull()
  })
})

describe('PUT /api/projects/:id/goals', () => {
  test('replaces the goals list and broadcasts an update', async () => {
    const projectId = await store.createProject('p', 'P')
    await store.setProjectGoals(projectId, [{ id: 'old', text: 'Old goal', done: false }])
    const res = await app.request(`/api/projects/${projectId}/goals`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        goals: [
          { id: 'g1', text: 'New goal A', done: false },
          { id: 'g2', text: 'New goal B', done: true },
        ],
      }),
    })
    expect(res.status).toBe(200)
    const stored = await store.getProjectGoals(projectId)
    expect(stored).toEqual([
      { id: 'g1', text: 'New goal A', done: false },
      { id: 'g2', text: 'New goal B', done: true },
    ])
    expect(broadcasts).toEqual([{ type: 'project_goals_update', data: { projectId } }])
  })

  test('accepts an empty array (clears goals)', async () => {
    const projectId = await store.createProject('p', 'P')
    await store.setProjectGoals(projectId, [{ id: 'g1', text: 'old', done: false }])
    const res = await app.request(`/api/projects/${projectId}/goals`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goals: [] }),
    })
    expect(res.status).toBe(200)
    expect(await store.getProjectGoals(projectId)).toEqual([])
  })

  test('400s when body is not JSON', async () => {
    const projectId = await store.createProject('p', 'P')
    const res = await app.request(`/api/projects/${projectId}/goals`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    })
    expect(res.status).toBe(400)
  })

  test('400s when goals field is missing or not an array', async () => {
    const projectId = await store.createProject('p', 'P')
    for (const body of [{}, { goals: 'oops' }, { goals: 42 }, { goals: null }]) {
      const res = await app.request(`/api/projects/${projectId}/goals`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      expect(res.status).toBe(400)
    }
  })

  test('400s when a goal is missing id or text', async () => {
    const projectId = await store.createProject('p', 'P')
    const res = await app.request(`/api/projects/${projectId}/goals`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goals: [{ id: '', text: 'no id', done: false }] }),
    })
    expect(res.status).toBe(400)
    const res2 = await app.request(`/api/projects/${projectId}/goals`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goals: [{ id: 'x', text: '', done: false }] }),
    })
    expect(res2.status).toBe(400)
  })

  test('400s on duplicate goal ids', async () => {
    const projectId = await store.createProject('p', 'P')
    const res = await app.request(`/api/projects/${projectId}/goals`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        goals: [
          { id: 'dup', text: 'first', done: false },
          { id: 'dup', text: 'second', done: false },
        ],
      }),
    })
    expect(res.status).toBe(400)
  })

  test('400s when a goal text exceeds the max length', async () => {
    const projectId = await store.createProject('p', 'P')
    const res = await app.request(`/api/projects/${projectId}/goals`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        goals: [{ id: 'g1', text: 'x'.repeat(201), done: false }],
      }),
    })
    expect(res.status).toBe(400)
  })

  test('400s when goals array exceeds the max length of 50', async () => {
    const projectId = await store.createProject('p', 'P')
    const goals = Array.from({ length: 51 }, (_, i) => ({
      id: `g${i}`,
      text: `goal ${i}`,
      done: false,
    }))
    const res = await app.request(`/api/projects/${projectId}/goals`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goals }),
    })
    expect(res.status).toBe(400)
  })

  test('404s when the project does not exist', async () => {
    const res = await app.request('/api/projects/999/goals', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goals: [] }),
    })
    expect(res.status).toBe(404)
  })

  test('coerces done to a strict boolean (truthy non-true becomes false)', async () => {
    const projectId = await store.createProject('p', 'P')
    await app.request(`/api/projects/${projectId}/goals`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        goals: [
          { id: 'g1', text: 'a', done: true },
          { id: 'g2', text: 'b', done: 1 },
          { id: 'g3', text: 'c', done: 'yes' },
        ],
      }),
    })
    const stored = await store.getProjectGoals(projectId)
    expect(stored).toEqual([
      { id: 'g1', text: 'a', done: true },
      { id: 'g2', text: 'b', done: false },
      { id: 'g3', text: 'c', done: false },
    ])
  })
})
