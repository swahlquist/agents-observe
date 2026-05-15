// app/server/src/lib/derive-status.test.ts
//
// Tests for the pure status derivation helper that backs HOME-01, HOME-02,
// HOME-11, HOME-12. Real captured journal Notification strings are quoted
// verbatim from .planning/PROJECT.md line 80; do not paraphrase.
//
// Per CLAUDE.md: no em dash characters (U+2014) and no double-hyphen runs
// in any string content in this file. The project rule treats them as a
// published-text policy violation.

import { describe, it, expect } from 'vitest'
import { deriveStatus, coerceWireLastActivity, type SessionStatus } from './derive-status'

// Minimal structural session-row fixture builder. Matches the shape
// returned by getRecentSessions / getSessionById (id, stopped_at,
// last_activity, pending_notification_ts, started_at).
function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sess-test',
    started_at: 1_700_000_000_000,
    stopped_at: null,
    last_activity: null,
    pending_notification_ts: null,
    ...overrides,
  }
}

// Minimal structural event-row fixture builder. Matches StoredEvent
// (id, hook_name, timestamp, payload as JSON string). The function
// accepts events in either ASC or DESC order; the test passes them
// in the order the storage layer returns them (DESC newest-first
// for getRecentEventsForSession, ASC for legacy getEventsForSession).
function makeEvent(
  hookName: string,
  timestamp: number,
  payload: Record<string, unknown> = {},
  overrides: Record<string, unknown> = {},
) {
  return {
    id: Math.floor(Math.random() * 1_000_000),
    agent_id: 'agent-1',
    session_id: 'sess-test',
    hook_name: hookName,
    timestamp,
    payload: JSON.stringify(payload),
    cwd: null,
    _meta: null,
    created_at: timestamp,
    ...overrides,
  }
}

const NOW = 1_700_001_000_000

describe('deriveStatus', () => {
  describe('FINISHED', () => {
    it('returns FINISHED when stopped_at is set, regardless of recency', () => {
      const session = makeSession({
        stopped_at: NOW - 5_000,
        last_activity: NOW - 1_000,
      })
      const events = [makeEvent('SessionEnd', NOW - 5_000, { reason: 'normal' })]
      const result = deriveStatus(session, events, NOW)
      expect(result.derivedStatus).toBe<SessionStatus>('FINISHED')
      expect(result.needsYou).toBe(false)
      expect(result.statusDetail).toBeNull()
      expect(result.lastActionLabel).toBe('Session ended')
      expect(result.lastActionAt).toBe(NOW - 5_000)
    })

    it('returns FINISHED even when stopped session is also very stale', () => {
      const session = makeSession({
        stopped_at: NOW - 60 * 60 * 1000,
        last_activity: NOW - 60 * 60 * 1000,
      })
      const result = deriveStatus(session, [], NOW)
      expect(result.derivedStatus).toBe<SessionStatus>('FINISHED')
      expect(result.needsYou).toBe(false)
    })
  })

  describe('WAITING_ON_PERMISSION', () => {
    it('parses real journal "Claude needs your permission to use Bash" string and extracts tool name', () => {
      const session = makeSession({
        pending_notification_ts: NOW - 1_000,
        last_activity: NOW - 1_000,
      })
      const events = [
        makeEvent('Notification', NOW - 1_000, {
          message: 'Claude needs your permission to use Bash',
        }),
      ]
      const result = deriveStatus(session, events, NOW)
      expect(result.derivedStatus).toBe<SessionStatus>('WAITING_ON_PERMISSION')
      expect(result.needsYou).toBe(true)
      expect(result.statusDetail).toBe('Bash')
      expect(result.lastActionLabel).toBe('Waiting on Bash permission')
      expect(result.lastActionAt).toBe(NOW - 1_000)
    })

    it('parses permission case-insensitively', () => {
      const session = makeSession({
        pending_notification_ts: NOW - 1_000,
      })
      const events = [
        makeEvent('Notification', NOW - 1_000, {
          message: 'Claude NEEDS YOUR PERMISSION to use Edit',
        }),
      ]
      const result = deriveStatus(session, events, NOW)
      expect(result.derivedStatus).toBe<SessionStatus>('WAITING_ON_PERMISSION')
      expect(result.statusDetail).toBe('Edit')
    })
  })

  describe('WAITING_FOR_INPUT', () => {
    it('classifies real journal "Claude Code needs your attention" as WAITING_FOR_INPUT with no detail', () => {
      const session = makeSession({
        pending_notification_ts: NOW - 1_000,
      })
      const events = [
        makeEvent('Notification', NOW - 1_000, {
          message: 'Claude Code needs your attention',
        }),
      ]
      const result = deriveStatus(session, events, NOW)
      expect(result.derivedStatus).toBe<SessionStatus>('WAITING_FOR_INPUT')
      expect(result.needsYou).toBe(true)
      expect(result.statusDetail).toBeNull()
      expect(result.lastActionLabel).toBe('Waiting for input')
    })

    it('classifies real journal "Claude is waiting for your input" as WAITING_FOR_INPUT with no detail', () => {
      const session = makeSession({
        pending_notification_ts: NOW - 1_000,
      })
      const events = [
        makeEvent('Notification', NOW - 1_000, {
          message: 'Claude is waiting for your input',
        }),
      ]
      const result = deriveStatus(session, events, NOW)
      expect(result.derivedStatus).toBe<SessionStatus>('WAITING_FOR_INPUT')
      expect(result.needsYou).toBe(true)
      expect(result.statusDetail).toBeNull()
      expect(result.lastActionLabel).toBe('Waiting for input')
    })

    it('falls back to WAITING_FOR_INPUT with sliced message detail for unrecognized Notification text', () => {
      const longMessage =
        'Some unrecognized future-Claude wording that should slice nicely to 40 chars max'
      const session = makeSession({
        pending_notification_ts: NOW - 1_000,
      })
      const events = [makeEvent('Notification', NOW - 1_000, { message: longMessage })]
      const result = deriveStatus(session, events, NOW)
      expect(result.derivedStatus).toBe<SessionStatus>('WAITING_FOR_INPUT')
      expect(result.needsYou).toBe(true)
      expect(result.statusDetail).toBe(longMessage.slice(0, 40))
      expect(result.statusDetail!.length).toBeLessThanOrEqual(40)
    })

    it('falls back to WAITING_FOR_INPUT with null detail when pending flag is set but window has zero Notification events (H6)', () => {
      const session = makeSession({
        pending_notification_ts: NOW - 60 * 60 * 1000,
      })
      // Window contains 50 BeforeTool events but no Notification. The
      // triggering Notification is older than the window. Server flag
      // is canonical; trust it.
      const events = Array.from({ length: 50 }, (_, i) =>
        makeEvent('BeforeTool', NOW - 60 * 1000 - i * 1000, {
          tool_name: 'Read',
        }),
      )
      const result = deriveStatus(session, events, NOW)
      expect(result.derivedStatus).toBe<SessionStatus>('WAITING_FOR_INPUT')
      expect(result.needsYou).toBe(true)
      expect(result.statusDetail).toBeNull()
      expect(result.lastActionLabel).toBe('Waiting for input')
    })
  })

  describe('recency cascade (WORKING / IDLE / ABANDONED)', () => {
    it('returns WORKING when last_activity is 30 seconds before now', () => {
      const session = makeSession({
        last_activity: NOW - 30_000,
      })
      const events = [makeEvent('AfterTool', NOW - 30_000, { tool_name: 'Read' })]
      const result = deriveStatus(session, events, NOW)
      expect(result.derivedStatus).toBe<SessionStatus>('WORKING')
      expect(result.needsYou).toBe(false)
      expect(result.lastActionLabel).toBe('Finished Read')
    })

    it('returns IDLE when last_activity is 15 minutes before now', () => {
      const session = makeSession({
        last_activity: NOW - 15 * 60 * 1000,
      })
      const result = deriveStatus(session, [], NOW)
      expect(result.derivedStatus).toBe<SessionStatus>('IDLE')
      expect(result.needsYou).toBe(false)
    })

    it('returns ABANDONED when last_activity is 45 minutes before now and not stopped', () => {
      const session = makeSession({
        last_activity: NOW - 45 * 60 * 1000,
      })
      const result = deriveStatus(session, [], NOW)
      expect(result.derivedStatus).toBe<SessionStatus>('ABANDONED')
      expect(result.needsYou).toBe(false)
    })
  })

  describe('NULL last_activity fallback (H3 mitigation)', () => {
    it('substitutes started_at and returns WORKING for fresh session with NULL last_activity', () => {
      const session = makeSession({
        last_activity: null,
        started_at: NOW - 5_000,
      })
      const result = deriveStatus(session, [], NOW)
      expect(result.derivedStatus).toBe<SessionStatus>('WORKING')
    })

    it('substitutes started_at and returns ABANDONED for old session with NULL last_activity', () => {
      const session = makeSession({
        last_activity: null,
        started_at: NOW - 45 * 60 * 1000,
      })
      const result = deriveStatus(session, [], NOW)
      expect(result.derivedStatus).toBe<SessionStatus>('ABANDONED')
    })

    it('defaults to WORKING when both last_activity and started_at are NULL', () => {
      const session = makeSession({
        last_activity: null,
        started_at: null,
      })
      const result = deriveStatus(session, [], NOW)
      expect(result.derivedStatus).toBe<SessionStatus>('WORKING')
    })
  })

  describe('lastActionLabel derivation per event kind', () => {
    it('maps BeforeTool to "Running <tool_name>"', () => {
      const session = makeSession({ last_activity: NOW - 30_000 })
      const events = [makeEvent('BeforeTool', NOW - 30_000, { tool_name: 'Bash' })]
      expect(deriveStatus(session, events, NOW).lastActionLabel).toBe('Running Bash')
    })

    it('maps AfterTool to "Finished <tool_name>"', () => {
      const session = makeSession({ last_activity: NOW - 30_000 })
      const events = [makeEvent('AfterTool', NOW - 30_000, { tool_name: 'Edit' })]
      expect(deriveStatus(session, events, NOW).lastActionLabel).toBe('Finished Edit')
    })

    it('maps UserPromptSubmit to "Prompt: " + first 50 chars of prompt', () => {
      const session = makeSession({ last_activity: NOW - 30_000 })
      const longPrompt =
        'Please refactor the entire authentication module to use the new JWT helper everywhere'
      const events = [makeEvent('UserPromptSubmit', NOW - 30_000, { prompt: longPrompt })]
      const label = deriveStatus(session, events, NOW).lastActionLabel!
      // Label is "Prompt: " + first 50 chars of prompt, then truncated
      // to 60 chars with a U+2026 ellipsis. The raw first-50-chars
      // is 8 + 50 = 58 chars, fits cleanly under the cap.
      expect(label.startsWith('Prompt: ')).toBe(true)
      expect(label.length).toBeLessThanOrEqual(60)
    })

    it('maps SessionStart to "Started session"', () => {
      const session = makeSession({ last_activity: NOW - 30_000 })
      const events = [makeEvent('SessionStart', NOW - 30_000)]
      expect(deriveStatus(session, events, NOW).lastActionLabel).toBe('Started session')
    })

    it('maps SessionEnd to "Session ended"', () => {
      const session = makeSession({
        stopped_at: NOW - 30_000,
        last_activity: NOW - 30_000,
      })
      const events = [makeEvent('SessionEnd', NOW - 30_000)]
      expect(deriveStatus(session, events, NOW).lastActionLabel).toBe('Session ended')
    })

    it('maps Stop to "Idle"', () => {
      const session = makeSession({ last_activity: NOW - 30_000 })
      const events = [makeEvent('Stop', NOW - 30_000)]
      expect(deriveStatus(session, events, NOW).lastActionLabel).toBe('Idle')
    })

    it('passes through unknown hook_name verbatim', () => {
      const session = makeSession({ last_activity: NOW - 30_000 })
      const events = [makeEvent('CustomNewHook', NOW - 30_000)]
      expect(deriveStatus(session, events, NOW).lastActionLabel).toBe('CustomNewHook')
    })

    it('truncates labels longer than 60 chars with single-character ellipsis U+2026', () => {
      const session = makeSession({ last_activity: NOW - 30_000 })
      // Trigger truncation via the unknown-hook passthrough branch.
      // (UserPromptSubmit can't exceed 60 chars because the prompt
      // body is sliced to 50 first; "Prompt: " + 50 = 58 chars max,
      // which is the right behavior. Truncation matters for branches
      // where the label can grow naturally, e.g. unknown hook names
      // and Notification messages that don't match the regex chain.)
      const longHookName = 'a'.repeat(100)
      const events = [makeEvent(longHookName, NOW - 30_000)]
      const label = deriveStatus(session, events, NOW).lastActionLabel!
      expect(label.length).toBe(60)
      expect(label.endsWith('…')).toBe(true)
      expect(label.includes('...')).toBe(false)
    })

    it('sets lastActionAt to the timestamp of the event used for the label', () => {
      const session = makeSession({ last_activity: NOW - 30_000 })
      const events = [makeEvent('BeforeTool', NOW - 30_000, { tool_name: 'Read' })]
      expect(deriveStatus(session, events, NOW).lastActionAt).toBe(NOW - 30_000)
    })

    it('returns null label and null timestamp when events array is empty', () => {
      const session = makeSession({ last_activity: NOW - 30_000 })
      const result = deriveStatus(session, [], NOW)
      expect(result.lastActionLabel).toBeNull()
      expect(result.lastActionAt).toBeNull()
      expect(result.derivedStatus).toBe<SessionStatus>('WORKING')
    })
  })
})

describe('coerceWireLastActivity (Round 3 New-H mitigation)', () => {
  it('substitutes started_at when last_activity is null', () => {
    const row = {
      last_activity: null,
      started_at: 1_700_000_000_000,
    }
    expect(coerceWireLastActivity(row)).toBe(1_700_000_000_000)
  })

  it('returns last_activity when it is a real number', () => {
    const row = {
      last_activity: 1_700_001_000_000,
      started_at: 1_700_000_000_000,
    }
    expect(coerceWireLastActivity(row)).toBe(1_700_001_000_000)
  })

  it('returns started_at when last_activity is undefined', () => {
    const row = {
      last_activity: undefined,
      started_at: 1_700_000_000_000,
    }
    expect(coerceWireLastActivity(row)).toBe(1_700_000_000_000)
  })
})
