import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/test-utils'
import { ProjectGoalsPanel } from './project-goals-panel'
import { useUIStore } from '@/stores/ui-store'
import * as apiClient from '@/lib/api-client'
import type { ProjectGoalsResponse, ProjectGoal } from '@/lib/api-client'

function makeGoal(overrides: Partial<ProjectGoalsResponse['goals'][number]> = {}) {
  return {
    id: 'g1',
    text: 'Refactor auth',
    done: false,
    linkedSessionId: null,
    linkedSessionSlug: null,
    linkedSessionIntent: null,
    ...overrides,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let updateSpy: any

beforeEach(() => {
  vi.restoreAllMocks()
  useUIStore.setState({
    selectedProjectId: null,
    selectedSessionId: null,
  })
  updateSpy = vi
    .spyOn(apiClient.api, 'updateProjectGoals')
    .mockResolvedValue({ ok: true } as { ok: true })
})

describe('ProjectGoalsPanel', () => {
  it('renders goals from the server with done count header', async () => {
    vi.spyOn(apiClient.api, 'getProjectGoals').mockResolvedValue({
      goals: [
        makeGoal({ id: 'g1', text: 'Refactor auth', done: true }),
        makeGoal({ id: 'g2', text: 'Ship banner', done: false }),
      ],
    })
    renderWithProviders(<ProjectGoalsPanel projectId={1} />)
    await waitFor(() => {
      expect(screen.getByText('Refactor auth')).toBeInTheDocument()
    })
    expect(screen.getByText('Ship banner')).toBeInTheDocument()
    expect(screen.getByText('1 of 2 done')).toBeInTheDocument()
  })

  it('shows a session link button when a goal is auto-linked', async () => {
    vi.spyOn(apiClient.api, 'getProjectGoals').mockResolvedValue({
      goals: [
        makeGoal({
          linkedSessionId: 'sA',
          linkedSessionSlug: 'twinkly-dragon',
          linkedSessionIntent: 'Refactor auth middleware',
        }),
      ],
    })
    renderWithProviders(<ProjectGoalsPanel projectId={1} />)
    await waitFor(() => {
      expect(screen.getByText('twinkly-dragon')).toBeInTheDocument()
    })
  })

  it('navigates to the linked session when its chip is clicked', async () => {
    vi.spyOn(apiClient.api, 'getProjectGoals').mockResolvedValue({
      goals: [
        makeGoal({
          linkedSessionId: 'sA',
          linkedSessionSlug: 'twinkly-dragon',
          linkedSessionIntent: 'Refactor auth middleware',
        }),
      ],
    })
    renderWithProviders(<ProjectGoalsPanel projectId={1} />)
    await waitFor(() => {
      expect(screen.getByText('twinkly-dragon')).toBeInTheDocument()
    })
    await userEvent.click(screen.getByText('twinkly-dragon'))
    expect(useUIStore.getState().selectedSessionId).toBe('sA')
  })

  it('adds a new goal on Enter and clears the input', async () => {
    vi.spyOn(apiClient.api, 'getProjectGoals').mockResolvedValue({ goals: [] })
    renderWithProviders(<ProjectGoalsPanel projectId={1} />)
    const input = await screen.findByPlaceholderText('Add a goal...')
    await userEvent.type(input, 'My new goal{Enter}')
    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledTimes(1)
    })
    const sentGoals = updateSpy.mock.calls[0][1] as ProjectGoal[]
    expect(sentGoals).toHaveLength(1)
    expect(sentGoals[0]).toMatchObject({ text: 'My new goal', done: false })
    expect(sentGoals[0].id).toBeTruthy()
    expect((input as HTMLInputElement).value).toBe('')
  })

  it('does not add an empty goal', async () => {
    vi.spyOn(apiClient.api, 'getProjectGoals').mockResolvedValue({ goals: [] })
    renderWithProviders(<ProjectGoalsPanel projectId={1} />)
    const input = await screen.findByPlaceholderText('Add a goal...')
    await userEvent.type(input, '   {Enter}')
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('toggles done state on the existing goal', async () => {
    vi.spyOn(apiClient.api, 'getProjectGoals').mockResolvedValue({
      goals: [makeGoal({ id: 'g1', text: 'Refactor auth', done: false })],
    })
    renderWithProviders(<ProjectGoalsPanel projectId={1} />)
    const checkbox = await screen.findByRole('checkbox')
    await userEvent.click(checkbox)
    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledTimes(1)
    })
    const sent = updateSpy.mock.calls[0][1] as ProjectGoal[]
    expect(sent).toEqual([{ id: 'g1', text: 'Refactor auth', done: true }])
  })

  it('strips link enrichment from goals before sending to the server', async () => {
    vi.spyOn(apiClient.api, 'getProjectGoals').mockResolvedValue({
      goals: [
        makeGoal({
          id: 'g1',
          text: 'Linked goal',
          done: false,
          linkedSessionId: 'sA',
          linkedSessionSlug: 'twinkly-dragon',
          linkedSessionIntent: 'Refactor auth',
        }),
      ],
    })
    renderWithProviders(<ProjectGoalsPanel projectId={1} />)
    const checkbox = await screen.findByRole('checkbox')
    await userEvent.click(checkbox)
    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledTimes(1)
    })
    const sent = updateSpy.mock.calls[0][1] as ProjectGoal[]
    // Server payload contains only id, text, done. Linked* enrichment
    // fields are derived per-request server-side and never round-trip.
    expect(sent[0]).toEqual({ id: 'g1', text: 'Linked goal', done: true })
    expect(Object.keys(sent[0])).toEqual(['id', 'text', 'done'])
  })
})
