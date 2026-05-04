import { describe, test, expect, vi, beforeEach } from 'vitest'
import { getNotionTasks, normalizeNotionPage, _resetNotionTasksCache } from './notion-tasks'

function makeNotionPage(
  overrides: Partial<{
    id: string
    url: string
    title: string
    status: string
    date: string
  }> = {},
) {
  const id = overrides.id ?? 'page-1'
  const url = overrides.url ?? `https://notion.so/${id}`
  const title = overrides.title ?? 'Ship the dashboard'
  const status = overrides.status ?? 'In progress'
  const date = overrides.date ?? '2026-05-03'
  return {
    id,
    url,
    properties: {
      Name: {
        type: 'title',
        title: [{ plain_text: title, type: 'text' }],
      },
      Status: {
        type: 'status',
        status: { name: status },
      },
      Date: {
        type: 'date',
        date: { start: date },
      },
    },
  }
}

describe('normalizeNotionPage', () => {
  test('extracts id, title, url, status, date', () => {
    const result = normalizeNotionPage(makeNotionPage(), {
      dateProperty: 'Date',
      statusProperty: 'Status',
    })
    expect(result).toEqual({
      id: 'page-1',
      title: 'Ship the dashboard',
      url: 'https://notion.so/page-1',
      status: 'In progress',
      dueAt: '2026-05-03',
    })
  })

  test('returns null when title is missing', () => {
    const page = makeNotionPage()
    page.properties.Name.title = []
    const result = normalizeNotionPage(page, {
      dateProperty: 'Date',
      statusProperty: 'Status',
    })
    expect(result).toBeNull()
  })

  test('returns null when id is missing', () => {
    const page = makeNotionPage()
    // @ts-expect-error intentional drop
    delete page.id
    const result = normalizeNotionPage(page, {
      dateProperty: 'Date',
      statusProperty: 'Status',
    })
    expect(result).toBeNull()
  })

  test('handles select-typed status property', () => {
    const page = makeNotionPage() as Record<string, unknown>
    ;(page.properties as Record<string, unknown>).Status = {
      type: 'select',
      select: { name: 'Backlog' },
    }
    const result = normalizeNotionPage(page, {
      dateProperty: 'Date',
      statusProperty: 'Status',
    })
    expect(result?.status).toBe('Backlog')
  })

  test('handles checkbox-typed status property', () => {
    const page = makeNotionPage() as Record<string, unknown>
    ;(page.properties as Record<string, unknown>).Status = {
      type: 'checkbox',
      checkbox: true,
    }
    const result = normalizeNotionPage(page, {
      dateProperty: 'Date',
      statusProperty: 'Status',
    })
    expect(result?.status).toBe('done')
  })

  test('returns null status when property is missing', () => {
    const page = makeNotionPage() as Record<string, unknown>
    delete (page.properties as Record<string, unknown>).Status
    const result = normalizeNotionPage(page, {
      dateProperty: 'Date',
      statusProperty: 'Status',
    })
    expect(result?.status).toBeNull()
  })
})

describe('getNotionTasks', () => {
  beforeEach(() => {
    _resetNotionTasksCache()
    vi.restoreAllMocks()
  })

  test('returns configured: false when token or db id is missing', async () => {
    const result = await getNotionTasks({ token: '', databaseId: 'abc' })
    expect(result).toEqual({ configured: false, tasks: [], cached: false })
  })

  test('queries notion and normalizes results', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        results: [makeNotionPage(), makeNotionPage({ id: 'page-2', title: 'Second' })],
      }),
    } as unknown as Response)

    const result = await getNotionTasks({
      token: 'tok',
      databaseId: 'db1',
      fetchImpl,
    })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://api.notion.com/v1/databases/db1/query')
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer tok')
    expect(headers['Notion-Version']).toBe('2022-06-28')

    expect(result.configured).toBe(true)
    expect(result.cached).toBe(false)
    expect(result.tasks).toHaveLength(2)
    expect(result.tasks[0].title).toBe('Ship the dashboard')
    expect(result.tasks[1].id).toBe('page-2')
  })

  test('caches results within ttl and skips a second fetch', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ results: [makeNotionPage()] }),
    } as unknown as Response)

    let now = 1_000_000
    const tick = () => now
    await getNotionTasks({
      token: 'tok',
      databaseId: 'db1',
      fetchImpl,
      cacheMs: 10_000,
      now: tick,
    })
    now += 5000
    const second = await getNotionTasks({
      token: 'tok',
      databaseId: 'db1',
      fetchImpl,
      cacheMs: 10_000,
      now: tick,
    })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(second.cached).toBe(true)
    expect(second.tasks).toHaveLength(1)
  })

  test('refetches once cache ttl expires', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ results: [makeNotionPage()] }),
    } as unknown as Response)

    let now = 1_000_000
    const tick = () => now
    await getNotionTasks({
      token: 'tok',
      databaseId: 'db1',
      fetchImpl,
      cacheMs: 10_000,
      now: tick,
    })
    now += 11_000
    const second = await getNotionTasks({
      token: 'tok',
      databaseId: 'db1',
      fetchImpl,
      cacheMs: 10_000,
      now: tick,
    })

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(second.cached).toBe(false)
  })

  test('throws when notion returns non-2xx', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'unauthorized',
    } as unknown as Response)

    await expect(
      getNotionTasks({
        token: 'tok',
        databaseId: 'db1',
        fetchImpl,
        bypassCache: true,
      }),
    ).rejects.toThrow(/401/)
  })

  test('skips rows that fail normalization (no title)', async () => {
    const goodPage = makeNotionPage()
    const badPage = makeNotionPage({ id: 'page-bad' })
    badPage.properties.Name.title = []

    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ results: [goodPage, badPage] }),
    } as unknown as Response)

    const result = await getNotionTasks({
      token: 'tok',
      databaseId: 'db1',
      fetchImpl,
      bypassCache: true,
    })
    expect(result.tasks).toHaveLength(1)
    expect(result.tasks[0].id).toBe('page-1')
  })
})
