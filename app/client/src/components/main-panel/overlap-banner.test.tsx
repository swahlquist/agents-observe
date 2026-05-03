import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/test-utils'
import { OverlapBanner } from './overlap-banner'
import { useUIStore } from '@/stores/ui-store'
import * as apiClient from '@/lib/api-client'
import type { OverlapPair, OverlapsResponse } from '@/lib/api-client'

function makePair(overrides: Partial<OverlapPair> = {}): OverlapPair {
  return {
    sessionA: 'sA',
    sessionAIntent: 'Refactor symbol search',
    sessionAIntentSource: 'manual',
    sessionASlug: 'twinkly-dragon',
    sessionAProjectId: 1,
    sessionB: 'sB',
    sessionBIntent: 'Auth middleware cleanup',
    sessionBIntentSource: 'auto',
    sessionBSlug: 'happy-otter',
    sessionBProjectId: 2,
    files: [
      {
        filePath: '/repo/foo.ts',
        aTouchedAt: 8000,
        bTouchedAt: 9000,
        aToolName: 'Edit',
        bToolName: 'Read',
      },
    ],
    lastTouchedAt: 9000,
    ...overrides,
  }
}

function mockOverlaps(response: OverlapsResponse) {
  vi.spyOn(apiClient.api, 'getOverlaps').mockResolvedValue(response)
}

beforeEach(() => {
  vi.restoreAllMocks()
  useUIStore.setState({
    selectedProjectId: null,
    selectedSessionId: null,
  })
})

describe('OverlapBanner', () => {
  it('renders nothing when there are no overlap pairs', async () => {
    mockOverlaps({ windowMs: 1800000, since: 0, pairs: [] })
    const { container } = renderWithProviders(<OverlapBanner />)
    await new Promise((r) => setTimeout(r, 0))
    expect(container.firstChild).toBeNull()
  })

  it('renders one row per pair with intent labels', async () => {
    mockOverlaps({
      windowMs: 1800000,
      since: 0,
      pairs: [makePair()],
    })
    renderWithProviders(<OverlapBanner />)
    await waitFor(() => {
      expect(screen.getByText(/Two sessions are touching/)).toBeInTheDocument()
    })
    expect(screen.getByText(/Refactor symbol search/)).toBeInTheDocument()
    expect(screen.getByText(/Auth middleware cleanup/)).toBeInTheDocument()
    expect(screen.getByText('foo.ts')).toBeInTheDocument()
  })

  it('falls back to slug when intent is null, and to id prefix when both are null', async () => {
    mockOverlaps({
      windowMs: 1800000,
      since: 0,
      pairs: [
        makePair({
          sessionAIntent: null,
          sessionAIntentSource: null,
          sessionBIntent: null,
          sessionBIntentSource: null,
          sessionBSlug: null,
          sessionB: 'abcdef1234567890',
        }),
      ],
    })
    renderWithProviders(<OverlapBanner />)
    await waitFor(() => {
      expect(screen.getByText(/twinkly-dragon/)).toBeInTheDocument()
      expect(screen.getByText(/abcdef12/)).toBeInTheDocument()
    })
  })

  it('summarizes multiple shared files inline', async () => {
    mockOverlaps({
      windowMs: 1800000,
      since: 0,
      pairs: [
        makePair({
          files: [
            {
              filePath: '/repo/foo.ts',
              aTouchedAt: 9000,
              bTouchedAt: 9100,
              aToolName: 'Edit',
              bToolName: 'Read',
            },
            {
              filePath: '/repo/bar.ts',
              aTouchedAt: 8500,
              bTouchedAt: 8600,
              aToolName: 'Edit',
              bToolName: 'Read',
            },
            {
              filePath: '/repo/baz.ts',
              aTouchedAt: 8000,
              bTouchedAt: 8100,
              aToolName: 'Edit',
              bToolName: 'Read',
            },
          ],
        }),
      ],
    })
    renderWithProviders(<OverlapBanner />)
    await waitFor(() => {
      expect(screen.getByText('foo.ts and 2 others')).toBeInTheDocument()
    })
  })

  it('uses singular "1 other" when exactly two files are shared', async () => {
    mockOverlaps({
      windowMs: 1800000,
      since: 0,
      pairs: [
        makePair({
          files: [
            {
              filePath: '/repo/foo.ts',
              aTouchedAt: 9000,
              bTouchedAt: 9100,
              aToolName: 'Edit',
              bToolName: 'Read',
            },
            {
              filePath: '/repo/bar.ts',
              aTouchedAt: 8500,
              bTouchedAt: 8600,
              aToolName: 'Edit',
              bToolName: 'Read',
            },
          ],
        }),
      ],
    })
    renderWithProviders(<OverlapBanner />)
    await waitFor(() => {
      expect(screen.getByText('foo.ts and 1 other')).toBeInTheDocument()
    })
  })

  it('shows a count header when more than one pair is rendered', async () => {
    mockOverlaps({
      windowMs: 1800000,
      since: 0,
      pairs: [
        makePair(),
        makePair({
          sessionA: 'sC',
          sessionASlug: 'sea-cucumber',
          sessionAIntent: null,
          sessionAIntentSource: null,
          sessionB: 'sD',
          sessionBSlug: 'jolly-beaver',
          sessionBIntent: null,
          sessionBIntentSource: null,
        }),
      ],
    })
    renderWithProviders(<OverlapBanner />)
    await waitFor(() => {
      expect(screen.getByText('2 session pairs are touching the same files')).toBeInTheDocument()
    })
  })

  it('filters by projectId when provided (keeps pairs where either side matches)', async () => {
    mockOverlaps({
      windowMs: 1800000,
      since: 0,
      pairs: [
        makePair({
          sessionAProjectId: 1,
          sessionBProjectId: 2,
          sessionAIntent: 'should be hidden',
        }),
        makePair({
          sessionA: 'sX',
          sessionAIntent: 'should be visible',
          sessionASlug: 'visible-x',
          sessionAProjectId: 5,
          sessionB: 'sY',
          sessionBIntent: null,
          sessionBSlug: 'visible-y',
          sessionBProjectId: 99,
        }),
      ],
    })
    renderWithProviders(<OverlapBanner projectId={99} />)
    await waitFor(() => {
      expect(screen.getByText(/should be visible/)).toBeInTheDocument()
    })
    expect(screen.queryByText(/should be hidden/)).not.toBeInTheDocument()
  })

  it('navigates to a session when its label is clicked', async () => {
    mockOverlaps({
      windowMs: 1800000,
      since: 0,
      pairs: [makePair()],
    })
    renderWithProviders(<OverlapBanner />)
    await waitFor(() => {
      expect(screen.getByText(/Refactor symbol search/)).toBeInTheDocument()
    })
    await userEvent.click(screen.getByText(/Refactor symbol search/))
    await new Promise((r) => setTimeout(r, 5))
    expect(useUIStore.getState().selectedSessionId).toBe('sA')
  })
})
