// app/server/src/services/notion-tasks.ts
//
// Thin client for the Notion Data Sources API. Pulls "today's tasks"
// from a configured database, normalizes the verbose Notion property
// shape into a flat `{id, title, url, status, dueAt}` record, and
// caches the result for `notionTasksCacheMs` so the UI can poll
// without hammering Notion.
//
// Configure via:
//   AGENTS_OBSERVE_NOTION_TOKEN
//   AGENTS_OBSERVE_NOTION_TASKS_DATABASE_ID
//   AGENTS_OBSERVE_NOTION_TASKS_DATE_PROPERTY  (default: "Date")
//   AGENTS_OBSERVE_NOTION_TASKS_STATUS_PROPERTY (default: "Status")

import { config } from '../config'

export interface ExternalTask {
  id: string
  title: string
  url: string | null
  status: string | null
  dueAt: string | null
}

interface CacheEntry {
  ts: number
  tasks: ExternalTask[]
}

let cache: CacheEntry | null = null

/** Test-only: clear the in-memory cache so each test runs cold. */
export function _resetNotionTasksCache(): void {
  cache = null
}

interface FetchOptions {
  /** Override fetch (used by tests). */
  fetchImpl?: typeof fetch
  /** Override the configured token. */
  token?: string
  /** Override the configured database id. */
  databaseId?: string
  /** Override the configured date property. */
  dateProperty?: string
  /** Override the configured status property. */
  statusProperty?: string
  /** Override cache TTL. */
  cacheMs?: number
  /** Skip the cache (used by tests). */
  bypassCache?: boolean
  /** Override `now` (used by tests for cache expiry). */
  now?: () => number
}

export interface NotionTasksResult {
  configured: boolean
  tasks: ExternalTask[]
  /** True when this response came from the in-memory cache. */
  cached: boolean
}

/**
 * Fetch today's tasks. Returns `configured: false` (with empty tasks)
 * when the Notion env vars are unset. Throws on Notion API failure so
 * the route layer can map to 502.
 */
export async function getNotionTasks(opts: FetchOptions = {}): Promise<NotionTasksResult> {
  const token = opts.token ?? config.notionToken
  const databaseId = opts.databaseId ?? config.notionTasksDatabaseId
  if (!token || !databaseId) {
    return { configured: false, tasks: [], cached: false }
  }

  const dateProperty = opts.dateProperty ?? config.notionTasksDateProperty
  const statusProperty = opts.statusProperty ?? config.notionTasksStatusProperty
  const cacheMs = opts.cacheMs ?? config.notionTasksCacheMs
  const now = opts.now ?? Date.now
  const fetchImpl = opts.fetchImpl ?? fetch

  if (!opts.bypassCache && cache && now() - cache.ts < cacheMs) {
    return { configured: true, tasks: cache.tasks, cached: true }
  }

  const today = new Date(now()).toISOString().slice(0, 10)
  const body = {
    filter: {
      and: [
        { property: dateProperty, date: { on_or_before: today } },
        { property: dateProperty, date: { is_not_empty: true } },
      ],
    },
    sorts: [{ property: dateProperty, direction: 'ascending' }],
    page_size: 50,
  }

  // Notion's REST shape: POST /v1/databases/:id/query is still the
  // documented endpoint for filter+sort queries. The newer data_sources
  // API is a superset but `/databases/.../query` works against both
  // legacy and data-source-backed databases.
  const res = await fetchImpl(`https://api.notion.com/v1/databases/${databaseId}/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await safeReadText(res)
    throw new Error(`Notion query failed: ${res.status} ${text.slice(0, 200)}`)
  }

  const json = (await res.json()) as { results?: unknown[] }
  const results = Array.isArray(json.results) ? json.results : []
  const tasks = results
    .map((row) => normalizeNotionPage(row, { dateProperty, statusProperty }))
    .filter((t): t is ExternalTask => t !== null)

  cache = { ts: now(), tasks }
  return { configured: true, tasks, cached: false }
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text()
  } catch {
    return ''
  }
}

interface NormalizeOpts {
  dateProperty: string
  statusProperty: string
}

/**
 * Map a Notion page object to ExternalTask. Returns null when the row
 * is missing the bits we need (no id, or no title text). Notion's
 * property shape is verbose and varies by property type, so we walk
 * the common ones (title, status, select, date) and ignore everything
 * else.
 */
export function normalizeNotionPage(row: unknown, opts: NormalizeOpts): ExternalTask | null {
  if (!row || typeof row !== 'object') return null
  const r = row as Record<string, unknown>
  const id = typeof r.id === 'string' ? r.id : null
  if (!id) return null

  const url = typeof r.url === 'string' ? r.url : null
  const properties = (r.properties as Record<string, unknown> | undefined) ?? {}

  const title = extractTitle(properties)
  if (!title) return null

  const status = extractStatus(properties[opts.statusProperty])
  const dueAt = extractDate(properties[opts.dateProperty])

  return { id, title, url, status, dueAt }
}

function extractTitle(properties: Record<string, unknown>): string | null {
  for (const value of Object.values(properties)) {
    if (!value || typeof value !== 'object') continue
    const v = value as Record<string, unknown>
    if (v.type !== 'title') continue
    const arr = v.title
    if (!Array.isArray(arr)) continue
    const text = arr
      .map((seg) => {
        if (!seg || typeof seg !== 'object') return ''
        const s = seg as Record<string, unknown>
        return typeof s.plain_text === 'string' ? s.plain_text : ''
      })
      .join('')
      .trim()
    if (text) return text
  }
  return null
}

function extractStatus(prop: unknown): string | null {
  if (!prop || typeof prop !== 'object') return null
  const p = prop as Record<string, unknown>
  if (p.type === 'status' && p.status && typeof p.status === 'object') {
    const name = (p.status as Record<string, unknown>).name
    return typeof name === 'string' ? name : null
  }
  if (p.type === 'select' && p.select && typeof p.select === 'object') {
    const name = (p.select as Record<string, unknown>).name
    return typeof name === 'string' ? name : null
  }
  if (p.type === 'checkbox') {
    return p.checkbox === true ? 'done' : 'open'
  }
  return null
}

function extractDate(prop: unknown): string | null {
  if (!prop || typeof prop !== 'object') return null
  const p = prop as Record<string, unknown>
  if (p.type !== 'date' || !p.date || typeof p.date !== 'object') return null
  const start = (p.date as Record<string, unknown>).start
  return typeof start === 'string' ? start : null
}
