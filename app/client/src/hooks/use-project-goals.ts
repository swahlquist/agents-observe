import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, type ProjectGoal, type ProjectGoalsResponse } from '@/lib/api-client'

const goalsKey = (projectId: number) => ['project-goals', projectId] as const

/**
 * Goals for a single project. Stays fresh via the WS
 * `project_goals_update` invalidation in `use-websocket.ts` and via the
 * mutation's onSuccess refetch. The server enriches each goal with its
 * matched session (if any) at read time, so this hook never has to
 * cross-reference sessions itself.
 */
export function useProjectGoals(projectId: number | null | undefined) {
  return useQuery<ProjectGoalsResponse>({
    queryKey: goalsKey(projectId ?? -1),
    queryFn: () => api.getProjectGoals(projectId!),
    enabled: projectId != null,
  })
}

/**
 * Replace the full goals array. Optimistic: snapshots the cache, writes
 * the new list immediately, and refetches on settle so the server's
 * auto-link enrichment lands. Rolls back on error.
 */
export function useUpdateProjectGoals(projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (goals: ProjectGoal[]) => api.updateProjectGoals(projectId, goals),
    onMutate: async (goals) => {
      await queryClient.cancelQueries({ queryKey: goalsKey(projectId) })
      const previous = queryClient.getQueryData<ProjectGoalsResponse>(goalsKey(projectId))
      // Optimistic write: keep any existing link enrichment for goals
      // whose id we still recognize, so the UI doesn't lose chips while
      // the server response is in flight.
      const prevById = new Map(previous?.goals.map((g) => [g.id, g]) ?? [])
      queryClient.setQueryData<ProjectGoalsResponse>(goalsKey(projectId), {
        goals: goals.map((g) => {
          const prev = prevById.get(g.id)
          return {
            ...g,
            linkedSessionId: prev?.linkedSessionId ?? null,
            linkedSessionSlug: prev?.linkedSessionSlug ?? null,
            linkedSessionIntent: prev?.linkedSessionIntent ?? null,
          }
        }),
      })
      return { previous }
    },
    onError: (_err, _goals, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(goalsKey(projectId), ctx.previous)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: goalsKey(projectId) })
    },
  })
}
