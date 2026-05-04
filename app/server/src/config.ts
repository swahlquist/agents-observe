// app/server/src/config.ts
// Central config for the server. All env var reads happen here.

import { resolve, dirname } from 'path'
import { readFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'

const logLevel = (process.env.AGENTS_OBSERVE_LOG_LEVEL || 'debug').toLowerCase()

function detectRuntime(): 'docker' | 'local' {
  const explicit = process.env.AGENTS_OBSERVE_RUNTIME
  if (explicit === 'docker' || explicit === 'local') return explicit
  if (existsSync('/.dockerenv')) return 'docker'
  return 'local'
}

function readVersion(): string {
  const dir = dirname(fileURLToPath(import.meta.url))
  const paths = [
    resolve(dir, '../../../VERSION'), // dev: app/server/src -> root
    resolve(dir, '../../VERSION'), // Docker: /app/server/src -> /app
    '/app/VERSION', // Docker fallback
  ]
  for (const p of paths) {
    try {
      return readFileSync(p, 'utf8').trim()
    } catch {
      continue
    }
  }
  return 'unknown'
}

export const config = {
  apiId: 'agents-observe',
  runtime: detectRuntime(),
  isDev: process.env.AGENTS_OBSERVE_RUNTIME_DEV === '1',
  version: readVersion(),
  port: parseInt(process.env.AGENTS_OBSERVE_SERVER_PORT || '4981', 10),
  logLevel,
  verbose: logLevel === 'debug' || logLevel === 'trace',
  dbPath: resolve(process.env.AGENTS_OBSERVE_DB_PATH || '../../data/observe.db'),
  storageAdapter: process.env.AGENTS_OBSERVE_STORAGE_ADAPTER || 'sqlite',
  clientDistPath: process.env.AGENTS_OBSERVE_CLIENT_DIST_PATH || '',
  devClientPort: parseInt(process.env.AGENTS_OBSERVE_DEV_CLIENT_PORT || '5174', 10),

  // DB reset policy: 'allow' = permit, 'deny' = reject, 'backup' (default) = backup then reset
  // Unrecognized values are treated as 'deny' to prevent misconfiguration
  allowDbReset:
    ({ allow: 'allow', backup: 'backup' } as Record<string, 'allow' | 'backup'>)[
      (process.env.AGENTS_OBSERVE_ALLOW_DB_RESET || 'backup').toLowerCase()
    ] ?? ('deny' as const),

  // Auto-shutdown: <= 0 disables, > 0 is delay in ms after last consumer disconnects
  shutdownDelayMs: parseInt(process.env.AGENTS_OBSERVE_SHUTDOWN_DELAY_MS || '30000', 10),
  // Consumer tracker tuning
  consumerTtlMs: 30_000,
  sweepIntervalMs: 10_000,
  startupGraceMs: 60_000,

  // Outgoing webhook (fire-and-forget POST on session start/stop/notification).
  // Empty string disables. The optional secret is sent as `X-Observe-Secret`
  // so the receiver can reject spoofed posts.
  outgoingWebhookUrl: process.env.AGENTS_OBSERVE_OUTGOING_WEBHOOK_URL || '',
  outgoingWebhookSecret: process.env.AGENTS_OBSERVE_OUTGOING_WEBHOOK_SECRET || '',
  outgoingWebhookTimeoutMs: parseInt(
    process.env.AGENTS_OBSERVE_OUTGOING_WEBHOOK_TIMEOUT_MS || '5000',
    10,
  ),

  // Notion bridge for the /api/external-tasks endpoint. When either
  // value is empty the endpoint reports `configured: false`.
  notionToken: process.env.AGENTS_OBSERVE_NOTION_TOKEN || '',
  notionTasksDatabaseId: process.env.AGENTS_OBSERVE_NOTION_TASKS_DATABASE_ID || '',
  notionTasksDateProperty: process.env.AGENTS_OBSERVE_NOTION_TASKS_DATE_PROPERTY || 'Date',
  notionTasksStatusProperty: process.env.AGENTS_OBSERVE_NOTION_TASKS_STATUS_PROPERTY || 'Status',
  notionTasksCacheMs: parseInt(process.env.AGENTS_OBSERVE_NOTION_TASKS_CACHE_MS || '60000', 10),
}
