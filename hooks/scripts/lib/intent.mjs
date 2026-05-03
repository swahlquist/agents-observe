// hooks/scripts/lib/intent.mjs
// /intent slash command implementation. Patches a session row with a
// short, human-readable description of what the session is doing.
//
// Wire flow:
//   /intent "<text>"  →  intentCommand(config, log, args)
//     1. Resolve session id — explicit --session-id flag, or
//        $CLAUDE_SESSION_ID env var, or the most recent active
//        session whose start_cwd matches --cwd / process.cwd().
//     2. PATCH /api/sessions/:id with { intent, intentSource }.
//     3. Print a single-line confirmation for Claude to surface.

import { getJson, httpRequest } from './http.mjs'

/**
 * Resolve which session this /intent call should target.
 *
 * Order:
 *   1. `--session-id <id>` CLI flag (explicit, always wins).
 *   2. `$CLAUDE_SESSION_ID` env var (set by Claude Code in newer
 *      releases when running slash commands).
 *   3. Most recent ACTIVE session whose `start_cwd` matches `cwd`.
 *      Active = `stoppedAt` is null. We prefer activity time so a
 *      session you've been working in for an hour wins over a brand
 *      new one in the same dir.
 *   4. Most recent active session, period — last-ditch fallback so the
 *      command degrades gracefully when cwd matching fails (e.g. you
 *      ran the command from a child directory).
 *
 * Returns `{ sessionId, source }` or `{ sessionId: null, source: 'none', reason }`.
 */
export async function resolveSessionId({ explicitId, cwd, baseUrl, log }) {
  if (explicitId) return { sessionId: explicitId, source: 'flag' }

  const fromEnv = process.env.CLAUDE_SESSION_ID
  if (fromEnv) return { sessionId: fromEnv, source: 'env' }

  // Last resort: ask the server. We pull a generous slice (50) since
  // the recent-sessions list is sorted by activity descending, so the
  // first match is the one we want.
  const res = await getJson(`${baseUrl}/sessions/recent?limit=50`, { log })
  if (res.status !== 200 || !Array.isArray(res.body)) {
    return {
      sessionId: null,
      source: 'none',
      reason: `Could not reach server at ${baseUrl} (status ${res.status})`,
    }
  }

  const active = res.body.filter((s) => !s.stoppedAt)
  if (active.length === 0) {
    return { sessionId: null, source: 'none', reason: 'No active sessions found' }
  }

  if (cwd) {
    const cwdMatch = active.find((s) => s.startCwd === cwd)
    if (cwdMatch) return { sessionId: cwdMatch.id, source: 'cwd' }
  }

  // Degrade to "most recent active" — the recent endpoint already
  // returns activity-sorted rows so [0] is the freshest.
  return {
    sessionId: active[0].id,
    source: 'fallback',
    note:
      cwd && !active.some((s) => s.startCwd === cwd)
        ? `No active session matched cwd ${cwd}; using the most recent active session instead.`
        : undefined,
  }
}

/**
 * PATCH /api/sessions/:id with the intent.
 */
export async function patchSessionIntent({ baseUrl, sessionId, intent, source, log }) {
  const url = `${baseUrl}/sessions/${encodeURIComponent(sessionId)}`
  const body = JSON.stringify({ intent, intentSource: source })
  return httpRequest(
    url,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      log,
    },
    body,
  )
}

/**
 * CLI entrypoint for `node observe_cli.mjs intent ...`.
 * Args shape (from observe_cli.mjs's parseArgs):
 *   { commands: ['intent', ...positionalText], sessionId, cwd, source }
 *
 * Resolves the session, performs the PATCH, prints a one-line result.
 */
export async function intentCommand(config, log, args) {
  const text = (args.intentText ?? '').trim()
  // Empty text = clear the intent. The server treats null as "remove".
  const intent = text.length === 0 ? null : text.slice(0, 200)
  const source = args.source === 'auto' ? 'auto' : 'manual'
  const cwd = args.cwd || process.cwd()

  const resolved = await resolveSessionId({
    explicitId: args.sessionId,
    cwd,
    baseUrl: config.apiBaseUrl,
    log,
  })

  if (!resolved.sessionId) {
    console.error(`/intent: ${resolved.reason || 'could not resolve session'}`)
    process.exit(1)
  }

  const result = await patchSessionIntent({
    baseUrl: config.apiBaseUrl,
    sessionId: resolved.sessionId,
    intent,
    source,
    log,
  })

  if (result.status !== 200 && result.status !== 204) {
    console.error(
      `/intent failed: HTTP ${result.status}${result.body ? ` — ${JSON.stringify(result.body)}` : ''}`,
    )
    process.exit(1)
  }

  const shortId = resolved.sessionId.slice(0, 8)
  if (intent === null) {
    console.log(`Cleared intent for session ${shortId}.`)
  } else {
    console.log(`Set intent for session ${shortId}: "${intent}"`)
  }
  if (resolved.note) console.log(resolved.note)
  if (resolved.source === 'fallback') {
    console.log(`(resolved via fallback — pass --session-id to be explicit next time)`)
  }
  process.exit(0)
}
