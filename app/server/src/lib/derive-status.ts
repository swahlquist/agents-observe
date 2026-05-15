// app/server/src/lib/derive-status.ts
//
// Pure derivation of the five new HOME-01 fields:
//   derivedStatus, statusDetail, needsYou, lastActionLabel, lastActionAt
//
// No I/O. Takes `now` as a parameter so tests can pin time.
// Status rules track CONTEXT.md (01A-CONTEXT.md) § "Status derivation
// rules" and § "Notification text parsing" verbatim. NULL last_activity
// substitutes started_at to avoid `now - null` coercing to `now` and
// pushing fresh / cleared sessions into ABANDONED (H3 mitigation).
//
// The function returns a `DerivedStatusFields` object whose six-state
// classification sits under the key `derivedStatus`. The legacy
// two-state `status: 'active' | 'ended'` field is computed elsewhere
// by `deriveSessionStatus(stoppedAt)` in routes/sessions.ts and is
// NOT produced here. Both fields stay on the wire for the duration
// of Phase 1a; Phase 1b migrates the 7+ in-repo consumers off the
// legacy field.

export type SessionStatus =
  | 'WORKING'
  | 'WAITING_FOR_INPUT'
  | 'WAITING_ON_PERMISSION'
  | 'IDLE'
  | 'FINISHED'
  | 'ABANDONED'

export interface DerivedStatusFields {
  derivedStatus: SessionStatus
  statusDetail: string | null
  needsYou: boolean
  lastActionLabel: string | null
  lastActionAt: number | null
}

// Structural row shape: we only read the columns this helper needs.
// Real callers pass rows from getRecentSessions / getSessionById.
interface SessionRow {
  stopped_at?: number | null
  last_activity?: number | null
  pending_notification_ts?: number | null
  started_at?: number | null
}

// Structural event shape: we only read these fields. Payload arrives
// as a JSON string from the storage layer (StoredEvent.payload).
interface EventRow {
  hook_name?: string | null
  timestamp?: number | null
  payload?: string | null
}

// Recency thresholds. The 60s WORKING window matches the existing
// pulse decay timer; the 30min IDLE-to-ABANDONED cutoff matches the
// existing overlap-detection window so there's one knob to tune.
const WORKING_WINDOW_MS = 60_000
const IDLE_CUTOFF_MS = 30 * 60_000

// Caps. Universal `statusDetail` cap is 64 chars (safety net above
// the 40-char slice used by the unmatched-message fallback). Label
// cap is 60 chars with a single-character ellipsis (U+2026).
const STATUS_DETAIL_MAX_CHARS = 64
const LABEL_MAX_CHARS = 60
const ELLIPSIS = '…'

// Slice length for the unmatched-Notification-message fallback.
// Inside the 64-char cap, this is the more specific (shorter) limit.
const UNRECOGNIZED_MESSAGE_SLICE = 40

// Slice length for the UserPromptSubmit label's prompt body. The full
// label is "Prompt: " + first 50 chars; total <= 58 chars, well under
// the 60-char cap.
const PROMPT_SLICE = 50

/**
 * Substitute `started_at` when `last_activity` is null or undefined.
 * Round 3 New-H mitigation: pins the wire-level `lastActivity` field
 * to `number` (never null) so the client type `RecentSession.lastActivity:
 * number` stays honest. `started_at` is `NOT NULL` per the schema, so
 * the substitution always yields a value.
 *
 * Used in `rowToRecentSession` (sessions.ts) AND inline at
 * `/projects/:id/sessions` (projects.ts) so the two endpoints emit
 * consistent values for sessions whose events were cleared.
 */
export function coerceWireLastActivity(row: {
  last_activity?: number | null
  started_at?: number | null
}): number | null {
  // Nullish coalescing handles both null and undefined. `started_at`
  // is NOT NULL in the schema but we keep the loose `?? null` final
  // clause defensively so degenerate test fixtures don't throw.
  return row.last_activity ?? row.started_at ?? null
}

interface ParsedMessage {
  status: SessionStatus
  statusDetail: string | null
  lastActionLabel: string
}

/**
 * Single regex chain over the most recent Notification event's
 * message text, applied in the order CONTEXT.md § "Notification text
 * parsing" lists. The first regex captures the tool name with
 * `[A-Za-z]+`; statusDetail for permission is `match[1]`, never the
 * whole message. Fallback (message present, unrecognized): slice to
 * 40 chars for the detail.
 */
function parseNotificationMessage(message: string): ParsedMessage {
  const permission = message.match(/needs your permission to use ([A-Za-z]+)/i)
  if (permission) {
    const tool = permission[1].slice(0, STATUS_DETAIL_MAX_CHARS)
    return {
      status: 'WAITING_ON_PERMISSION',
      statusDetail: tool,
      lastActionLabel: `Waiting on ${tool} permission`,
    }
  }
  if (/needs your attention/i.test(message)) {
    return {
      status: 'WAITING_FOR_INPUT',
      statusDetail: null,
      lastActionLabel: 'Waiting for input',
    }
  }
  if (/waiting for your input/i.test(message)) {
    return {
      status: 'WAITING_FOR_INPUT',
      statusDetail: null,
      lastActionLabel: 'Waiting for input',
    }
  }
  // Fallback 4: message present but unrecognized. Slice to 40 chars
  // (the more specific limit; the 64-char universal cap is the safety
  // net for everything else).
  return {
    status: 'WAITING_FOR_INPUT',
    statusDetail: message.slice(0, UNRECOGNIZED_MESSAGE_SLICE),
    lastActionLabel: 'Waiting for input',
  }
}

/** Truncate to LABEL_MAX_CHARS with single-character U+2026 ellipsis. */
function truncateLabel(label: string): string {
  if (label.length <= LABEL_MAX_CHARS) return label
  return label.slice(0, LABEL_MAX_CHARS - 1) + ELLIPSIS
}

/**
 * Build the label + timestamp from a single event row. Returns null
 * only when the event has no timestamp; malformed JSON payloads fall
 * back to a hook-name-only label (the catch block sets payload = {}
 * and walks through the switch as normal). WR-07: previous docstring
 * said this returned null on bad JSON, which is not what the body did.
 */
function eventToLabel(event: EventRow): { label: string; at: number } | null {
  const hook = event.hook_name ?? ''
  const ts = event.timestamp ?? null
  if (ts === null) return null

  let payload: Record<string, unknown> = {}
  if (typeof event.payload === 'string' && event.payload) {
    try {
      payload = JSON.parse(event.payload) as Record<string, unknown>
    } catch {
      // Bad JSON in storage. Fall through to a hook-name-only label.
      payload = {}
    }
  }

  switch (hook) {
    case 'BeforeTool': {
      const tool = typeof payload.tool_name === 'string' ? payload.tool_name : 'tool'
      return { label: truncateLabel(`Running ${tool}`), at: ts }
    }
    case 'AfterTool': {
      const tool = typeof payload.tool_name === 'string' ? payload.tool_name : 'tool'
      return { label: truncateLabel(`Finished ${tool}`), at: ts }
    }
    case 'UserPromptSubmit': {
      const prompt = typeof payload.prompt === 'string' ? payload.prompt : ''
      return {
        label: truncateLabel(`Prompt: ${prompt.slice(0, PROMPT_SLICE)}`),
        at: ts,
      }
    }
    case 'Notification': {
      const message = typeof payload.message === 'string' ? payload.message : ''
      if (!message) {
        return { label: 'Waiting for input', at: ts }
      }
      // For label purposes, reuse the same parser the status branch
      // uses. Keeps "Waiting on Bash permission" and "Waiting for
      // input" in lockstep with the derivedStatus.
      const parsed = parseNotificationMessage(message)
      return { label: truncateLabel(parsed.lastActionLabel), at: ts }
    }
    case 'SessionStart':
      return { label: 'Started session', at: ts }
    case 'SessionEnd':
      return { label: 'Session ended', at: ts }
    case 'Stop':
      return { label: 'Idle', at: ts }
    default:
      return { label: truncateLabel(hook || 'unknown'), at: ts }
  }
}

/**
 * Sort events newest-first by timestamp. Used by both `pickLastAction`
 * and `findMostRecentNotification` so they cannot disagree about which
 * event is newest (WR-03 / WR-04).
 *
 * Pre-WR-03, `pickLastAction` autodetected ASC vs DESC via
 * `lastTs >= firstTs`. When every event in the batch shared one
 * timestamp (a burst recorded at the same ms), the check returned true
 * and the array was reversed, flipping correctly-ordered DESC data on
 * its head. `findMostRecentNotification` used a linear-scan max which
 * was correct regardless of order, so the two functions could disagree
 * about "newest." Sort defensively once and feed both branches; events
 * is bounded at 50 so the sort is free.
 */
function sortEventsDescByTimestamp(events: EventRow[]): EventRow[] {
  return events.slice().sort((a, b) => (b.timestamp ?? -Infinity) - (a.timestamp ?? -Infinity))
}

/**
 * Walk events newest-first and return the first label-producing event.
 * Looks at the last 5 events; matches CONTEXT.md § "lastActionLabel
 * derivation" semantics. Requires events in DESC order (caller's
 * responsibility); use `sortEventsDescByTimestamp` defensively if you
 * cannot guarantee ordering.
 */
function pickLastAction(events: EventRow[]): { label: string; at: number } | null {
  if (events.length === 0) return null
  // Look at the last 5 (i.e. first 5 of the newest-first slice).
  const window = events.slice(0, 5)
  for (const ev of window) {
    const result = eventToLabel(ev)
    if (result) return result
  }
  return null
}

/**
 * Find the most recent Notification event in the events array.
 * Requires DESC order (caller's responsibility); returns the first
 * Notification encountered.
 */
function findMostRecentNotification(events: EventRow[]): EventRow | null {
  for (const ev of events) {
    if (ev.hook_name === 'Notification') return ev
  }
  return null
}

/**
 * Pure status derivation. See CONTEXT.md § "Status derivation rules"
 * for the priority order and rationale.
 */
export function deriveStatus(
  session: SessionRow,
  events: EventRow[],
  now: number,
): DerivedStatusFields {
  // Sort once defensively (WR-03 / WR-04) so pickLastAction and
  // findMostRecentNotification can never disagree about "newest."
  // events is bounded at 50 by the caller (RECENT_EVENTS_PER_SESSION),
  // so the sort cost is negligible.
  const orderedEvents = sortEventsDescByTimestamp(events)
  const lastAction = pickLastAction(orderedEvents)
  const lastActionLabel = lastAction?.label ?? null
  const lastActionAt = lastAction?.at ?? null

  // 1. FINISHED takes precedence over everything else.
  if (session.stopped_at) {
    return {
      derivedStatus: 'FINISHED',
      statusDetail: null,
      needsYou: false,
      lastActionLabel,
      lastActionAt,
    }
  }

  // 2. Pending notification flag is canonical.
  if (session.pending_notification_ts) {
    const mostRecentNotification = findMostRecentNotification(orderedEvents)
    if (!mostRecentNotification) {
      // Fallback 5 (H6 mitigation): flag set, no Notification in the
      // fetched window. Default to WAITING_FOR_INPUT; trust the flag.
      return {
        derivedStatus: 'WAITING_FOR_INPUT',
        statusDetail: null,
        needsYou: true,
        lastActionLabel: 'Waiting for input',
        lastActionAt: lastActionAt,
      }
    }
    let message = ''
    if (typeof mostRecentNotification.payload === 'string') {
      try {
        const parsed = JSON.parse(mostRecentNotification.payload) as Record<string, unknown>
        if (typeof parsed.message === 'string') message = parsed.message
      } catch {
        // Bad JSON in storage. Fall through with empty message; the
        // parser's unrecognized-fallback handles it.
      }
    }
    if (!message) {
      // No parseable message text. Treat as input-fallback.
      return {
        derivedStatus: 'WAITING_FOR_INPUT',
        statusDetail: null,
        needsYou: true,
        lastActionLabel: 'Waiting for input',
        lastActionAt: lastActionAt,
      }
    }
    const parsed = parseNotificationMessage(message)
    return {
      derivedStatus: parsed.status,
      statusDetail:
        parsed.statusDetail !== null ? parsed.statusDetail.slice(0, STATUS_DETAIL_MAX_CHARS) : null,
      needsYou: true,
      lastActionLabel,
      lastActionAt,
    }
  }

  // 3. Recency cascade. NULL last_activity substitutes started_at;
  // if both are null, default to WORKING (degenerate but safe).
  const referenceTs = session.last_activity ?? session.started_at ?? null
  if (referenceTs === null) {
    return {
      derivedStatus: 'WORKING',
      statusDetail: null,
      needsYou: false,
      lastActionLabel,
      lastActionAt,
    }
  }

  const age = now - referenceTs
  let derivedStatus: SessionStatus
  if (age < WORKING_WINDOW_MS) {
    derivedStatus = 'WORKING'
  } else if (age < IDLE_CUTOFF_MS) {
    derivedStatus = 'IDLE'
  } else {
    derivedStatus = 'ABANDONED'
  }

  return {
    derivedStatus,
    statusDetail: null,
    needsYou: false,
    lastActionLabel,
    lastActionAt,
  }
}
