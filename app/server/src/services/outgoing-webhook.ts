// app/server/src/services/outgoing-webhook.ts
//
// Fire-and-forget POST to an external URL (n8n, Slack relay, Make.com, etc.)
// whenever a notable session lifecycle event happens. The request handler
// must never block on the webhook -- failures are logged and dropped.
//
// Configure via AGENTS_OBSERVE_OUTGOING_WEBHOOK_URL. Optional shared
// secret rides as `X-Observe-Secret` so the receiver can reject forged
// requests.

import { config } from '../config'

export type OutgoingWebhookType = 'session_start' | 'session_stop' | 'notification'

export interface OutgoingWebhookPayload {
  type: OutgoingWebhookType
  ts: number
  sessionId: string
  sessionSlug: string | null
  intent: string | null
  intentSource: 'manual' | 'auto' | null
  projectId: number | null
  projectSlug: string | null
  projectName: string | null
}

interface PostOptions {
  /** Override the configured URL (used by tests). */
  url?: string
  /** Override the configured secret (used by tests). */
  secret?: string
  /** Override the configured timeout (used by tests). */
  timeoutMs?: number
  /** Override the global fetch (used by tests to assert the call). */
  fetchImpl?: typeof fetch
}

/**
 * Post a webhook payload. Always returns immediately. The actual fetch
 * runs detached. Returns `true` when a fetch was scheduled, `false` when
 * the webhook is unconfigured (so callers can short-circuit logging).
 */
export function postOutgoingWebhook(
  payload: OutgoingWebhookPayload,
  opts: PostOptions = {},
): boolean {
  const url = opts.url ?? config.outgoingWebhookUrl
  if (!url) return false

  const secret = opts.secret ?? config.outgoingWebhookSecret
  const timeoutMs = opts.timeoutMs ?? config.outgoingWebhookTimeoutMs
  const fetchImpl = opts.fetchImpl ?? fetch

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': `agents-observe/${config.version}`,
  }
  if (secret) headers['X-Observe-Secret'] = secret

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  // Detached. Catch on the resulting promise so a rejection never
  // surfaces as an unhandled rejection in the server process.
  fetchImpl(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal: controller.signal,
  })
    .then((res) => {
      if (!res.ok) {
        console.warn(
          `[webhook] POST ${url} -> ${res.status} for type=${payload.type} session=${payload.sessionId}`,
        )
      }
    })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(
        `[webhook] POST ${url} failed for type=${payload.type} session=${payload.sessionId}: ${msg}`,
      )
    })
    .finally(() => clearTimeout(timer))

  return true
}
