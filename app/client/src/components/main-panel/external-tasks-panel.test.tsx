import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/test-utils'
import { ExternalTasksPanel } from './external-tasks-panel'
import * as apiClient from '@/lib/api-client'
import type { ExternalTasksResponse } from '@/lib/api-client'

function makeResponse(overrides: Partial<ExternalTasksResponse> = {}): ExternalTasksResponse {
  return {
    configured: true,
    cached: false,
    tasks: [],
    ...overrides,
  }
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('ExternalTasksPanel', () => {
  it('renders nothing when the bridge is unconfigured', async () => {
    vi.spyOn(apiClient.api, 'getExternalTasks').mockResolvedValue(
      makeResponse({ configured: false }),
    )
    const { container } = renderWithProviders(<ExternalTasksPanel />)
    await waitFor(() => {
      expect(apiClient.api.getExternalTasks).toHaveBeenCalled()
    })
    // The panel returns null both while loading and once it sees
    // configured: false, so container stays empty across both states.
    await waitFor(() => {
      expect(container.textContent).toBe('')
    })
  })

  it('renders task rows with title, status, and due date', async () => {
    vi.spyOn(apiClient.api, 'getExternalTasks').mockResolvedValue(
      makeResponse({
        tasks: [
          {
            id: 't1',
            title: 'Ship the dashboard',
            url: 'https://notion.so/t1',
            status: 'In progress',
            dueAt: '2099-01-01',
          },
        ],
      }),
    )
    renderWithProviders(<ExternalTasksPanel />)
    await waitFor(() => {
      expect(screen.getByText('Ship the dashboard')).toBeInTheDocument()
    })
    expect(screen.getByText('In progress')).toBeInTheDocument()
    expect(screen.getByText('2099-01-01')).toBeInTheDocument()
    expect(screen.getByText('1 from Notion')).toBeInTheDocument()
  })

  it('shows an empty-state message when configured but tasks list is empty', async () => {
    vi.spyOn(apiClient.api, 'getExternalTasks').mockResolvedValue(makeResponse())
    renderWithProviders(<ExternalTasksPanel />)
    await waitFor(() => {
      expect(screen.getByText('Nothing scheduled for today.')).toBeInTheDocument()
    })
    expect(screen.getByText('no tasks')).toBeInTheDocument()
  })

  it('renders task title as a link when url is present', async () => {
    vi.spyOn(apiClient.api, 'getExternalTasks').mockResolvedValue(
      makeResponse({
        tasks: [
          {
            id: 't1',
            title: 'Ship it',
            url: 'https://notion.so/t1',
            status: null,
            dueAt: null,
          },
        ],
      }),
    )
    renderWithProviders(<ExternalTasksPanel />)
    const link = await screen.findByRole('link', { name: /Ship it/ })
    expect(link).toHaveAttribute('href', 'https://notion.so/t1')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('renders task title as plain text when url is missing', async () => {
    vi.spyOn(apiClient.api, 'getExternalTasks').mockResolvedValue(
      makeResponse({
        tasks: [
          {
            id: 't1',
            title: 'No url here',
            url: null,
            status: null,
            dueAt: null,
          },
        ],
      }),
    )
    renderWithProviders(<ExternalTasksPanel />)
    await waitFor(() => {
      expect(screen.getByText('No url here')).toBeInTheDocument()
    })
    expect(screen.queryByRole('link', { name: /No url here/ })).not.toBeInTheDocument()
  })

  it('collapses and expands when the header is clicked', async () => {
    vi.spyOn(apiClient.api, 'getExternalTasks').mockResolvedValue(
      makeResponse({
        tasks: [
          {
            id: 't1',
            title: 'Ship the dashboard',
            url: null,
            status: null,
            dueAt: null,
          },
        ],
      }),
    )
    renderWithProviders(<ExternalTasksPanel />)
    await screen.findByText('Ship the dashboard')
    await userEvent.click(screen.getByText('Today'))
    expect(screen.queryByText('Ship the dashboard')).not.toBeInTheDocument()
    await userEvent.click(screen.getByText('Today'))
    expect(screen.getByText('Ship the dashboard')).toBeInTheDocument()
  })
})
