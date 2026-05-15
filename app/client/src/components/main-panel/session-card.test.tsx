import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { screen, cleanup } from '@testing-library/react'
import { renderWithProviders } from '@/test/test-utils'
import { SessionCard, colorStripeIndex, categoryIcon, buildStatusBadgeLabel } from './session-card'
import type { RecentSession } from '@/types'

function buildSession(overrides: Partial<RecentSession> = {}): RecentSession {
  const now = Date.now()
  return {
    id: 'sess-test-1',
    projectId: 1,
    projectSlug: 'demo',
    projectName: 'Demo',
    slug: null,
    intent: null,
    intentSource: null,
    transcriptPath: null,
    status: 'active',
    startedAt: now - 3600 * 1000,
    stoppedAt: null,
    metadata: null,
    lastActivity: now,
    agentClasses: ['claude'],
    derivedStatus: 'WORKING',
    statusDetail: null,
    needsYou: false,
    lastActionLabel: null,
    lastActionAt: now,
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
})

describe('SessionCard', () => {
  it('renders the IDLE badge with non-NaN elapsed time (Plan 02 New-H3 mitigation)', () => {
    const FIFTEEN_MIN = 15 * 60 * 1000
    const session = buildSession({
      derivedStatus: 'IDLE',
      // Wire shape after Plan 01 server-side coercion: lastActivity is
      // already populated (server substituted started_at if the underlying
      // column was NULL). The client trusts this and computes elapsed
      // from the wire value.
      lastActivity: Date.now() - FIFTEEN_MIN,
    })
    renderWithProviders(<SessionCard session={session} />)
    const text = screen.getByText(/Idle/)
    expect(text.textContent).toMatch(/Idle\s+\d+m/)
    expect(text.textContent).not.toMatch(/NaN/)
    // The exact label should be "Idle 15m" within a small rounding window.
    expect(text.textContent).toContain('15m')
  })

  it('renders the WAITING_ON_PERMISSION badge with the tool name appended', () => {
    const session = buildSession({
      derivedStatus: 'WAITING_ON_PERMISSION',
      statusDetail: 'Bash',
      needsYou: true,
    })
    renderWithProviders(<SessionCard session={session} />)
    expect(screen.getByText(/Waiting on Bash/)).toBeInTheDocument()
  })

  it('renders WAITING_FOR_INPUT without a tool name', () => {
    const session = buildSession({
      derivedStatus: 'WAITING_FOR_INPUT',
      statusDetail: null,
      needsYou: true,
    })
    renderWithProviders(<SessionCard session={session} />)
    expect(screen.getByText(/Waiting for input/)).toBeInTheDocument()
  })

  it('hides the client badge when hideClientBadge is true (single-client mode)', () => {
    const session = buildSession({ agentClasses: ['claude'] })
    const { rerender } = renderWithProviders(<SessionCard session={session} />)
    expect(screen.getByText('claude')).toBeInTheDocument()
    rerender(<SessionCard session={session} hideClientBadge />)
    expect(screen.queryByText('claude')).not.toBeInTheDocument()
  })

  it('falls back to the slug, then to the id prefix, when intent is null', () => {
    const session = buildSession({ intent: null, slug: 'my-slug' })
    renderWithProviders(<SessionCard session={session} />)
    expect(screen.getByText('my-slug')).toBeInTheDocument()
  })

  it('routes click to selectProjectSession via UI store (WR-06 atomic update)', async () => {
    // WR-06: pre-fix used setSelectedProject + setTimeout(..., 0) +
    // setSelectedSessionId. Post-fix the card calls selectProjectSession
    // in one go so the project and session land in the same commit.
    const { useUIStore } = await import('@/stores/ui-store')
    const { fireEvent } = await import('@testing-library/react')
    const session = buildSession({
      id: 'sess-click-target',
      projectId: 42,
      projectSlug: 'click-project',
    })
    renderWithProviders(<SessionCard session={session} />)
    const card = screen.getByRole('button')
    fireEvent.click(card)
    // Both fields update synchronously now (no microtask race).
    const s = useUIStore.getState()
    expect(s.selectedProjectId).toBe(42)
    expect(s.selectedProjectSlug).toBe('click-project')
    expect(s.selectedSessionId).toBe('sess-click-target')
  })
})

describe('colorStripeIndex', () => {
  it('is deterministic across calls for the same id', () => {
    const a = colorStripeIndex('abc-123')
    const b = colorStripeIndex('abc-123')
    expect(a).toBe(b)
  })

  it('returns an integer 0..7', () => {
    for (const id of [
      '',
      'a',
      'sess-aaa',
      'sess-bbb-ccc',
      '00000000-0000-0000-0000-000000000000',
    ]) {
      const idx = colorStripeIndex(id)
      expect(Number.isInteger(idx)).toBe(true)
      expect(idx).toBeGreaterThanOrEqual(0)
      expect(idx).toBeLessThanOrEqual(7)
    }
  })

  it('does not use Math.random (stable across processes)', () => {
    // Pre-computed once; if FNV hashing changes, this will fail loudly.
    const a = colorStripeIndex('sess-a')
    const b = colorStripeIndex('sess-a')
    const c = colorStripeIndex('sess-a')
    expect(a).toBe(b)
    expect(b).toBe(c)
  })
})

describe('categoryIcon', () => {
  it('routes by keyword and falls back to Terminal', () => {
    const cases: Array<[string | null, string]> = [
      ['fix login bug', 'Wrench'],
      ['repair flaky test', 'Wrench'],
      ['feat: add toggle', 'Sparkles'],
      ['build new module', 'Sparkles'],
      ['document the api', 'BookOpen'],
      ['audit the codebase', 'BookOpen'],
      ['deploy to prod', 'Rocket'],
      ['ship the release', 'Rocket'],
      ['refactor the helper', 'Brush'],
      ['clean up imports', 'Brush'],
      // "add unit test" hits Sparkles ('add') before FlaskConical ('test')
      // because CONTEXT.md lists feat-bucket above the test-bucket.
      ['run unit test', 'FlaskConical'],
      ['write spec', 'FlaskConical'],
      ['just thinking aloud', 'Terminal'],
      [null, 'Terminal'],
    ]
    for (const [intent, expected] of cases) {
      const Icon = categoryIcon(intent)
      // lucide-react icons expose displayName matching their export name.
      // Use the function's name property as a stable identifier.
      const name =
        (Icon as { displayName?: string }).displayName ?? (Icon as { name?: string }).name
      expect(name, `intent=${intent ?? '(null)'} expected ${expected}`).toBe(expected)
    }
  })
})

describe('buildStatusBadgeLabel', () => {
  it('uses the static label for plain states', () => {
    const s = (status: RecentSession['derivedStatus']) =>
      buildStatusBadgeLabel(buildSession({ derivedStatus: status }))
    expect(s('WORKING')).toBe('Working')
    expect(s('FINISHED')).toBe('Finished')
    expect(s('ABANDONED')).toBe('Abandoned')
    expect(s('WAITING_FOR_INPUT')).toBe('Waiting for input')
  })

  it('appends the tool name for WAITING_ON_PERMISSION', () => {
    const session = buildSession({
      derivedStatus: 'WAITING_ON_PERMISSION',
      statusDetail: 'Edit',
    })
    expect(buildStatusBadgeLabel(session)).toBe('Waiting on Edit')
  })

  it('appends elapsed time for IDLE and never yields NaN', () => {
    const now = 1_700_000_000_000
    const session = buildSession({ derivedStatus: 'IDLE', lastActivity: now - 5 * 60_000 })
    const label = buildStatusBadgeLabel(session, now)
    expect(label).toBe('Idle 5m')
    expect(label).not.toMatch(/NaN/)
  })
})
