import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import * as notionService from '../services/notion-tasks'

let app: Hono
let getNotionTasksSpy: ReturnType<typeof vi.spyOn>

beforeEach(async () => {
  vi.restoreAllMocks()
  notionService._resetNotionTasksCache()
  const { default: router } = await import('./external-tasks')
  app = new Hono()
  app.route('/api', router)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('GET /api/external-tasks', () => {
  test('returns configured: false when notion is unconfigured', async () => {
    getNotionTasksSpy = vi
      .spyOn(notionService, 'getNotionTasks')
      .mockResolvedValue({ configured: false, tasks: [], cached: false })
    const res = await app.request('/api/external-tasks')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ configured: false, tasks: [], cached: false })
    expect(getNotionTasksSpy).toHaveBeenCalledTimes(1)
  })

  test('returns tasks from notion when configured', async () => {
    vi.spyOn(notionService, 'getNotionTasks').mockResolvedValue({
      configured: true,
      cached: false,
      tasks: [
        {
          id: 'page-1',
          title: 'Ship the dashboard',
          url: 'https://notion.so/page-1',
          status: 'In progress',
          dueAt: '2026-05-03',
        },
      ],
    })
    const res = await app.request('/api/external-tasks')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { tasks: unknown[] }
    expect(body.tasks).toHaveLength(1)
  })

  test('returns 502 when notion fetch throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(notionService, 'getNotionTasks').mockRejectedValue(
      new Error('Notion query failed: 401 unauthorized'),
    )
    const res = await app.request('/api/external-tasks')
    expect(res.status).toBe(502)
    const body = (await res.json()) as { error: { message: string; details: string } }
    expect(body.error.message).toBe('Notion fetch failed')
    expect(body.error.details).toMatch(/401/)
  })
})
