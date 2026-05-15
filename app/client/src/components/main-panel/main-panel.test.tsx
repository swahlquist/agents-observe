import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/test-utils'
import { MainPanel } from './main-panel'
import { useUIStore } from '@/stores/ui-store'

// Mock child components to isolate routing logic.
// We verify which component gets rendered based on UI store state.

vi.mock('./home-page', () => ({
  HomePage: () => <div data-testid="home-page">HomePage</div>,
}))

vi.mock('./project-page', () => ({
  ProjectPage: () => <div data-testid="project-page">ProjectPage</div>,
}))

vi.mock('./session-breadcrumb', () => ({
  SessionBreadcrumb: () => <div data-testid="session-breadcrumb">Breadcrumb</div>,
}))

vi.mock('./scope-bar', () => ({
  ScopeBar: () => <div data-testid="scope-bar">ScopeBar</div>,
}))

vi.mock('./event-filter-bar', () => ({
  EventFilterBar: () => <div data-testid="event-filter-bar">EventFilterBar</div>,
}))

vi.mock('@/components/timeline/activity-timeline', () => ({
  ActivityTimeline: () => <div data-testid="activity-timeline">ActivityTimeline</div>,
}))

vi.mock('@/components/event-stream/event-stream', () => ({
  EventStream: () => <div data-testid="event-stream">EventStream</div>,
}))

vi.mock('@/agents/event-processing-context', () => ({
  EventProcessingProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@/hooks/use-region-shortcuts', () => ({
  useRegionShortcuts: () => {},
}))

vi.mock('@/hooks/use-effective-events', () => ({
  useEffectiveEvents: () => ({ data: [] }),
}))

vi.mock('@/hooks/use-agents', () => ({
  useAgents: () => [],
}))

vi.mock('@/hooks/use-recent-sessions', () => ({
  useRecentSessions: () => ({
    data: [
      {
        id: 'sess-1',
        projectId: 1,
        projectSlug: 'demo',
        projectName: 'Demo',
        slug: null,
        intent: 'fix login bug',
        intentSource: 'manual',
        transcriptPath: null,
        status: 'active',
        startedAt: Date.now() - 60_000,
        stoppedAt: null,
        metadata: null,
        lastActivity: Date.now(),
        agentClasses: ['claude'],
        derivedStatus: 'WORKING',
        statusDetail: null,
        needsYou: false,
        lastActionLabel: 'Running Bash',
        lastActionAt: Date.now() - 5_000,
      },
    ],
    isLoading: false,
  }),
}))

beforeEach(() => {
  useUIStore.setState({
    selectedProjectId: null,
    selectedSessionId: null,
    selectedAgentIds: [],
    activeStaticFilters: [],
    activeToolFilters: [],
    searchQuery: '',
    sessionFilterStates: new Map(),
  })
  // Reset URL search params between tests so getInitialTab() defaults
  // to 'overview' unless a test explicitly sets ?tab=activity.
  window.history.replaceState({}, '', window.location.pathname)
})

describe('MainPanel routing', () => {
  it('should render HomePage when no project is selected', () => {
    renderWithProviders(<MainPanel />)

    expect(screen.getByTestId('home-page')).toBeInTheDocument()
    expect(screen.queryByTestId('project-page')).not.toBeInTheDocument()
    expect(screen.queryByTestId('scope-bar')).not.toBeInTheDocument()
    expect(screen.queryByTestId('event-stream')).not.toBeInTheDocument()
  })

  it('should render ProjectPage when project is selected but no session', () => {
    useUIStore.setState({ selectedProjectId: 1 })

    renderWithProviders(<MainPanel />)

    expect(screen.getByTestId('project-page')).toBeInTheDocument()
    expect(screen.queryByTestId('home-page')).not.toBeInTheDocument()
    expect(screen.queryByTestId('scope-bar')).not.toBeInTheDocument()
    expect(screen.queryByTestId('event-stream')).not.toBeInTheDocument()
  })

  it('renders SessionView with Overview tab by default and Activity tab hidden', () => {
    useUIStore.setState({
      selectedProjectId: 1,
      selectedSessionId: 'sess-1',
    })

    renderWithProviders(<MainPanel />)

    // Tab strip exists with both triggers.
    expect(screen.getByRole('tab', { name: 'Overview' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Activity' })).toBeInTheDocument()
    // Overview is the active tab.
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('data-state', 'active')
    // Activity tab content is not rendered (Radix unmounts inactive panels by default).
    expect(screen.queryByTestId('scope-bar')).not.toBeInTheDocument()
    expect(screen.queryByTestId('event-stream')).not.toBeInTheDocument()
    // Overview placeholder shows the derived-field card.
    expect(screen.getByText('fix login bug')).toBeInTheDocument()
    expect(screen.getByText('Tasks: arriving in Phase 1b')).toBeInTheDocument()
  })

  it('switches to the Activity tab on click and writes ?tab=activity to the URL', async () => {
    const user = userEvent.setup()
    useUIStore.setState({
      selectedProjectId: 1,
      selectedSessionId: 'sess-1',
    })

    renderWithProviders(<MainPanel />)

    await user.click(screen.getByRole('tab', { name: 'Activity' }))

    expect(screen.getByTestId('scope-bar')).toBeInTheDocument()
    expect(screen.getByTestId('activity-timeline')).toBeInTheDocument()
    expect(screen.getByTestId('event-stream')).toBeInTheDocument()
    expect(window.location.search).toContain('tab=activity')
  })

  it('respects ?tab=activity in the URL on mount', () => {
    window.history.replaceState({}, '', '/?tab=activity')
    useUIStore.setState({
      selectedProjectId: 1,
      selectedSessionId: 'sess-1',
    })

    renderWithProviders(<MainPanel />)

    expect(screen.getByRole('tab', { name: 'Activity' })).toHaveAttribute('data-state', 'active')
    expect(screen.getByTestId('scope-bar')).toBeInTheDocument()
  })

  it('should transition from session view back to ProjectPage when session is deselected', () => {
    useUIStore.setState({
      selectedProjectId: 1,
      selectedSessionId: 'sess-1',
    })

    const { rerender } = renderWithProviders(<MainPanel />)
    // SessionView renders the tab strip; the breadcrumb mock confirms the view is mounted.
    expect(screen.getByTestId('session-breadcrumb')).toBeInTheDocument()

    // Deselect session.
    act(() => {
      useUIStore.setState({ selectedSessionId: null })
    })
    rerender(<MainPanel />)

    expect(screen.getByTestId('project-page')).toBeInTheDocument()
    expect(screen.queryByTestId('session-breadcrumb')).not.toBeInTheDocument()
  })

  it('should transition from ProjectPage to HomePage when project is deselected', () => {
    useUIStore.setState({ selectedProjectId: 1 })

    const { rerender } = renderWithProviders(<MainPanel />)
    expect(screen.getByTestId('project-page')).toBeInTheDocument()

    // Deselect project.
    act(() => {
      useUIStore.setState({ selectedProjectId: null })
    })
    rerender(<MainPanel />)

    expect(screen.getByTestId('home-page')).toBeInTheDocument()
    expect(screen.queryByTestId('project-page')).not.toBeInTheDocument()
  })
})
