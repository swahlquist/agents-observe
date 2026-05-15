import { useEffect, useState } from 'react'
import { useUIStore } from '@/stores/ui-store'
import { useEffectiveEvents } from '@/hooks/use-effective-events'
import { useAgents } from '@/hooks/use-agents'
import { useRecentSessions } from '@/hooks/use-recent-sessions'
import { EventProcessingProvider } from '@/agents/event-processing-context'
import { SessionBreadcrumb } from './session-breadcrumb'
import { ScopeBar } from './scope-bar'
import { EventFilterBar } from './event-filter-bar'
import { ActivityTimeline } from '@/components/timeline/activity-timeline'
import { EventStream } from '@/components/event-stream/event-stream'
import { HomePage } from './home-page'
import { ProjectPage } from './project-page'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useRegionShortcuts } from '@/hooks/use-region-shortcuts'
import { STATUS_BADGE, buildStatusBadgeLabel } from './session-card'
import { cn } from '@/lib/utils'

export function MainPanel() {
  const { selectedProjectId, selectedProjectSlug, selectedSessionId } = useUIStore()

  // The URL hash populates `selectedProjectSlug` / `selectedSessionId`
  // synchronously on store init, but `selectedProjectId` is resolved
  // asynchronously by `useRouteSync` once /api/projects (and possibly
  // /api/sessions/:id) has returned. Don't flash HomePage in that
  // window; it triggers /api/sessions/recent and other home-page
  // queries that get torn down a tick later.
  const isResolvingRoute = !selectedProjectId && (!!selectedProjectSlug || !!selectedSessionId)
  if (isResolvingRoute) {
    return <div className="flex-1" />
  }

  if (!selectedProjectId) {
    return <HomePage />
  }

  if (!selectedSessionId) {
    return <ProjectPage />
  }

  return <SessionView sessionId={selectedSessionId} projectId={selectedProjectId} />
}

type SessionTab = 'overview' | 'activity'

function getInitialTab(): SessionTab {
  if (typeof window === 'undefined') return 'overview'
  const raw = new URLSearchParams(window.location.search).get('tab')
  return raw === 'activity' ? 'activity' : 'overview'
}

function writeTabToUrl(tab: SessionTab) {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  url.searchParams.set('tab', tab)
  window.history.replaceState({}, '', url.toString())
}

function SessionView({ sessionId, projectId }: { sessionId: string; projectId: number }) {
  useRegionShortcuts()
  // Phase 1a uses the home view's recent-sessions cache as the source of
  // truth for the Overview placeholder. /api/projects/:id/sessions does
  // NOT carry the new derived fields in Phase 1a (deferred to Phase 1b),
  // so we read from useRecentSessions and match by session id. Sessions
  // outside the 30-session window are handled by the fallback string.
  const { data: recent } = useRecentSessions(30)
  const session = recent?.find((s) => s.id === sessionId) ?? null
  const eventsQuery = useEffectiveEvents(sessionId)
  const rawEvents = eventsQuery.data
  const agents = useAgents(sessionId, rawEvents)

  const [tab, setTab] = useState<SessionTab>(getInitialTab)

  useEffect(() => {
    // Persist the active tab to the URL whenever it changes (replaceState
    // so we do not pollute browser history with tab toggles).
    writeTabToUrl(tab)
  }, [tab])

  const onTabChange = (value: string) => {
    if (value === 'overview' || value === 'activity') {
      setTab(value)
    }
  }

  return (
    <EventProcessingProvider rawEvents={rawEvents} agents={agents}>
      <div className="flex-1 flex flex-col overflow-hidden">
        <SessionBreadcrumb />
        <Tabs value={tab} onValueChange={onTabChange} className="flex-1 flex flex-col">
          <TabsList className="mx-3 mt-2 self-start">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="flex-1 overflow-y-auto">
            <OverviewTabBody session={session} />
          </TabsContent>
          <TabsContent value="activity" className="flex-1 flex flex-col overflow-hidden">
            <ScopeBar />
            <EventFilterBar />
            <ActivityTimeline />
            <EventStream key={sessionId} />
          </TabsContent>
        </Tabs>
        {/* projectId is consumed by SessionBreadcrumb / ScopeBar; keep
            the prop to preserve the existing API. */}
        {projectId == null && null}
      </div>
    </EventProcessingProvider>
  )
}

interface OverviewTabBodyProps {
  session: ReturnType<typeof useRecentSessions>['data'] extends Array<infer T> | undefined
    ? T | null
    : null
}

function OverviewTabBody({ session }: OverviewTabBodyProps) {
  if (!session) {
    return (
      <div className="px-4 py-6 text-sm text-muted-foreground">
        No recent activity. Open the Activity tab for full timeline.
      </div>
    )
  }
  const intent = session.intent ?? '(no intent set)'
  const lastActionLabel = session.lastActionLabel ?? 'no recent action'
  const badge = STATUS_BADGE[session.derivedStatus]
  const badgeLabel = buildStatusBadgeLabel(session)

  return (
    <div className="px-4 py-4 flex flex-col gap-3 max-w-xl">
      <div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Intent</div>
        <div className="text-sm font-medium">{intent}</div>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Last action</div>
        <div className="text-sm">{lastActionLabel}</div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Status</span>
        <span
          className={cn(
            'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium',
            badge?.className,
          )}
        >
          {badgeLabel}
        </span>
      </div>
      <div className="text-xs text-muted-foreground italic">Tasks: arriving in Phase 1b</div>
    </div>
  )
}
