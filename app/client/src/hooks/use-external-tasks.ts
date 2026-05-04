import { useQuery } from '@tanstack/react-query'
import { api, type ExternalTasksResponse } from '@/lib/api-client'

/**
 * Today's tasks from the configured Notion database. The server caches
 * its Notion fetch for ~60s, so polling at 60s here keeps the UI fresh
 * without ever hitting Notion's rate limits. When the bridge is
 * unconfigured the server returns `{configured: false, tasks: []}` and
 * the UI hides the panel.
 */
export function useExternalTasks() {
  return useQuery<ExternalTasksResponse>({
    queryKey: ['external-tasks'],
    queryFn: () => api.getExternalTasks(),
    refetchInterval: 60_000,
    staleTime: 30_000,
  })
}
