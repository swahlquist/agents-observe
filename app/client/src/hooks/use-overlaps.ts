import { useQuery } from '@tanstack/react-query'
import { api, type OverlapsResponse } from '@/lib/api-client'

/**
 * Cached fetch of `/api/overlaps`. Stays fresh via WS-driven
 * invalidation in `use-websocket.ts` (overlaps_update). The server
 * broadcasts that signal whenever a tool event recorded a file touch,
 * so the cache turns over only when something potentially changed.
 *
 * No polling: a payload-free WS message + React Query refetch is
 * cheaper and snappier than an interval timer running on every tab.
 */
export function useOverlaps() {
  return useQuery<OverlapsResponse>({
    queryKey: ['overlaps'],
    queryFn: () => api.getOverlaps(),
  })
}
