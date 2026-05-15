import { describe, it, expect, afterEach } from 'vitest'
import { screen, cleanup, fireEvent } from '@testing-library/react'
import { renderWithProviders } from '@/test/test-utils'
import { FinishedToday } from './finished-today'
import type { RecentSession } from '@/types'

function buildSession(overrides: Partial<RecentSession> = {}): RecentSession {
  const now = Date.now()
  return {
    id: 'sess-fin-1',
    projectId: 1,
    projectSlug: 'demo',
    projectName: 'Demo',
    slug: null,
    intent: 'finished task',
    intentSource: null,
    transcriptPath: null,
    status: 'ended',
    startedAt: now - 3600 * 1000,
    stoppedAt: now - 60 * 1000,
    metadata: null,
    lastActivity: now - 60 * 1000,
    agentClasses: ['claude'],
    derivedStatus: 'FINISHED',
    statusDetail: null,
    needsYou: false,
    lastActionLabel: 'Session ended',
    lastActionAt: now - 60 * 1000,
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
})

describe('FinishedToday', () => {
  it('returns null when there are no sessions', () => {
    const { container } = renderWithProviders(<FinishedToday sessions={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('starts collapsed by default and expands when clicked', () => {
    renderWithProviders(<FinishedToday sessions={[buildSession()]} />)
    // Collapsed: no SessionCard text visible.
    expect(screen.queryByText('finished task')).toBeNull()
    // Click header to expand.
    fireEvent.click(screen.getByRole('button', { name: /Finished today/i }))
    expect(screen.getByText('finished task')).toBeTruthy()
  })

  it('starts expanded when forceOpen is true on mount', () => {
    renderWithProviders(<FinishedToday sessions={[buildSession()]} forceOpen />)
    expect(screen.getByText('finished task')).toBeTruthy()
  })

  it('auto-expands when forceOpen flips from false to true after mount (CR-03)', () => {
    // Pre-CR-03: useState(forceOpen) only honored the prop on mount,
    // so when HomePage transitioned "active sessions exist" to "only
    // finished today" (real workflow when user finishes their last
    // running session), the section stayed collapsed.
    const sessions = [buildSession()]
    const { rerender } = renderWithProviders(
      <FinishedToday sessions={sessions} forceOpen={false} />,
    )
    expect(screen.queryByText('finished task')).toBeNull()
    rerender(<FinishedToday sessions={sessions} forceOpen={true} />)
    expect(screen.getByText('finished task')).toBeTruthy()
  })

  it('respects user manual collapse after auto-expand (does not re-fire on the same forceOpen value)', () => {
    const sessions = [buildSession()]
    const { rerender } = renderWithProviders(
      <FinishedToday sessions={sessions} forceOpen={true} />,
    )
    // Auto-expanded on mount.
    expect(screen.getByText('finished task')).toBeTruthy()
    // User collapses manually.
    fireEvent.click(screen.getByRole('button', { name: /Finished today/i }))
    expect(screen.queryByText('finished task')).toBeNull()
    // A re-render with the same forceOpen=true must NOT re-expand
    // (lastForceOpenRef gates on value change).
    rerender(<FinishedToday sessions={sessions} forceOpen={true} />)
    expect(screen.queryByText('finished task')).toBeNull()
  })
})
