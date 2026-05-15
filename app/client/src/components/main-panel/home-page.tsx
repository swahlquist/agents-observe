import { useMemo } from 'react'
import { useRecentSessions } from '@/hooks/use-recent-sessions'
import { useBell } from '@/hooks/use-bell'
import { useTabTitle } from '@/hooks/use-tab-title'
import { OverlapBanner } from './overlap-banner'
import { ExternalTasksPanel } from './external-tasks-panel'
import { NeedsYouPile } from './needs-you-pile'
import { ProjectGroup } from './project-group'
import { FinishedToday } from './finished-today'
import type { RecentSession } from '@/types'

interface GroupedProject {
  projectId: number | null
  projectName: string
  projectSlug: string | null
  activeSessions: RecentSession[]
  finishedTodaySessions: RecentSession[]
}

/** Local midnight (today, in the user's tz), as ms since epoch. */
function localMidnightToday(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** True iff the session is finished and stopped after local midnight today. */
function isFinishedToday(session: RecentSession, midnight: number): boolean {
  return session.derivedStatus === 'FINISHED' && (session.stoppedAt ?? 0) >= midnight
}

export function HomePage() {
  const { data: sessions, isLoading } = useRecentSessions(30)

  const {
    needsYouSessions,
    projectGroups,
    finishedTodaySessionsFlat,
    hideClientBadge,
    needsYouCount,
    topSessionIntent,
    activeCount,
    onlyFinishedToday,
  } = useMemo(() => {
    const list: RecentSession[] = sessions ?? []
    const midnight = localMidnightToday()

    const needsYou = list.filter((s) => s.needsYou)
    needsYou.sort((a, b) => (b.lastActionAt ?? 0) - (a.lastActionAt ?? 0))

    // Single-client mode: hide the per-card client badge entirely when
    // every visible session shares one client class.
    const uniqueClients = new Set<string>()
    for (const s of list) {
      for (const c of s.agentClasses) uniqueClients.add(c)
    }
    const hideClientBadge = uniqueClients.size <= 1

    // Group by project. Sessions without a project_id land in a synthetic
    // "Unassigned" bucket.
    type Bucket = GroupedProject
    const buckets = new Map<string, Bucket>()
    const keyFor = (projectId: number | null) =>
      projectId == null ? 'unassigned' : String(projectId)

    for (const s of list) {
      const k = keyFor(s.projectId)
      let b = buckets.get(k)
      if (!b) {
        b = {
          projectId: s.projectId,
          projectName: s.projectName ?? (s.projectId == null ? 'Unassigned' : 'Project'),
          projectSlug: s.projectSlug,
          activeSessions: [],
          finishedTodaySessions: [],
        }
        buckets.set(k, b)
      }
      if (isFinishedToday(s, midnight)) {
        b.finishedTodaySessions.push(s)
      } else if (s.derivedStatus !== 'FINISHED') {
        // Active = anything not FINISHED. FINISHED sessions older than
        // local midnight just drop out of the home view (the 30-session
        // window trims them naturally).
        b.activeSessions.push(s)
      }
    }
    const projectGroups: GroupedProject[] = [...buckets.values()].sort((a, b) =>
      a.projectName.localeCompare(b.projectName),
    )

    // Flat list of finished-today sessions across all projects, for the
    // bottom "Finished today" section.
    const finishedTodaySessionsFlat = list.filter((s) => isFinishedToday(s, midnight))

    const needsYouCount = needsYou.length
    const topSessionIntent = needsYou[0]?.intent ?? null
    const activeCount = projectGroups.reduce((sum, g) => sum + g.activeSessions.length, 0)
    const onlyFinishedToday =
      list.length > 0 && activeCount === 0 && finishedTodaySessionsFlat.length > 0

    return {
      needsYouSessions: needsYou,
      projectGroups,
      finishedTodaySessionsFlat,
      hideClientBadge,
      needsYouCount,
      topSessionIntent,
      activeCount,
      onlyFinishedToday,
    }
  }, [sessions])

  // Side effects: unconditional tab title, gated audible bell.
  useTabTitle(needsYouCount, topSessionIntent)
  useBell(needsYouCount)

  const hasSessions = (sessions?.length ?? 0) > 0

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <OverlapBanner />
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="flex items-center justify-center h-32 text-xs text-muted-foreground">
            Loading...
          </div>
        )}
        {!isLoading && !hasSessions && (
          <div className="px-4 py-6 text-sm text-muted-foreground">
            No sessions yet. Run a Claude Code or Gemini CLI command to see it here.
          </div>
        )}
        {!isLoading && hasSessions && (
          <>
            {onlyFinishedToday ? (
              <div className="px-4 py-3 text-sm text-muted-foreground border-b border-border">
                All quiet. Nothing active.
              </div>
            ) : (
              <>
                <NeedsYouPile sessions={needsYouSessions} hideClientBadge={hideClientBadge} />
                {projectGroups.map((g) => (
                  <ProjectGroup
                    key={`${g.projectId ?? 'unassigned'}`}
                    projectId={g.projectId}
                    projectName={g.projectName}
                    projectSlug={g.projectSlug}
                    activeSessions={g.activeSessions}
                    finishedTodaySessions={g.finishedTodaySessions}
                    hideClientBadge={hideClientBadge}
                  />
                ))}
              </>
            )}
            <FinishedToday
              sessions={finishedTodaySessionsFlat}
              hideClientBadge={hideClientBadge}
              forceOpen={onlyFinishedToday}
            />
          </>
        )}
        <ExternalTasksPanel />
      </div>
    </div>
  )
}
