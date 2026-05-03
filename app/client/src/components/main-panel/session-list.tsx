import { useUIStore } from '@/stores/ui-store'
import { cn } from '@/lib/utils'
import { Clock, Folder, Activity } from 'lucide-react'
import {
  NotificationIndicator,
  dismissNotification,
  useSessionHasNotification,
} from '@/components/sidebar/notification-indicator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { Session, RecentSession } from '@/types'

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return `${Math.floor(days / 30)}mo ago`
}

function shortenCwd(cwd: string): string {
  return cwd.replace(/^\/(?:Users|home)\/[^/]+/, '~')
}

interface SessionListProps {
  sessions: (Session | RecentSession)[]
  showProject?: boolean
  sortBy?: 'activity' | 'created'
}

export function SessionList({
  sessions,
  showProject = false,
  sortBy = 'activity',
}: SessionListProps) {
  const { setSelectedProject, setSelectedSessionId } = useUIStore()

  const handleSessionClick = (projectId: number | null, projectSlug: string, sessionId: string) => {
    // Sessions in the Unassigned bucket have no project; clicking one
    // just selects the session and clears any project selection.
    setSelectedProject(projectId, projectId ? projectSlug : null)
    setTimeout(() => setSelectedSessionId(sessionId), 0)
  }

  if (sessions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-2">
        <Activity className="h-8 w-8 opacity-30" />
        <span className="text-sm">No sessions yet</span>
        <span className="text-xs">Sessions will appear here as agents connect</span>
      </div>
    )
  }

  return (
    <div className="divide-y divide-border">
      {sessions.map((session) => (
        <SessionRow
          key={session.id}
          session={session}
          showProject={showProject}
          sortBy={sortBy}
          onSelect={() =>
            handleSessionClick(
              session.projectId,
              'projectSlug' in session ? session.projectSlug || '' : '',
              session.id,
            )
          }
        />
      ))}
    </div>
  )
}

function SessionRow({
  session,
  showProject,
  sortBy,
  onSelect,
}: {
  session: Session | RecentSession
  showProject: boolean
  sortBy: 'activity' | 'created'
  onSelect: () => void
}) {
  // Title precedence: explicit intent (from /intent or auto-derive) →
  // human slug → first 8 chars of session id. The slug stays as the
  // hover tooltip so anyone debugging by slug name can still find it.
  const slug = session.slug
  const intent = session.intent ?? null
  const intentSource = session.intentSource ?? null
  const fallback = slug || session.id.slice(0, 8)
  const title = intent || fallback
  const showSlugSubline = !!intent && !!slug && slug !== intent
  const cwd = typeof session.metadata?.cwd === 'string' ? session.metadata.cwd : null
  const lastTime =
    sortBy === 'activity'
      ? ('lastActivity' in session && session.lastActivity) || session.startedAt
      : session.startedAt
  const projectName = 'projectName' in session ? session.projectName : null
  const needsAttention = useSessionHasNotification(session.id)

  const titleEl = (
    <span
      className={cn(
        'text-sm font-medium truncate',
        // Auto-derived intents are shown a touch lighter so users can
        // see at a glance which sessions still want a real /intent set.
        intentSource === 'auto' && 'text-foreground/85 italic',
      )}
    >
      {title}
    </span>
  )

  return (
    <button
      className={cn(
        'w-full text-left px-4 py-3 hover:bg-accent/50 transition-colors cursor-pointer',
        'focus:outline-none focus-visible:ring-1 focus-visible:ring-ring',
      )}
      onClick={onSelect}
    >
      <div className="flex items-center gap-2 min-w-0">
        {needsAttention ? (
          // Bell replaces the green/grey status dot when the session
          // is waiting on the user. Click absorbs to dismiss without
          // navigating away.
          <NotificationIndicator
            compact
            className="h-2.5 w-2.5"
            onClick={(e) => {
              e.stopPropagation()
              dismissNotification(session.id)
            }}
          />
        ) : (
          <span
            className={cn(
              'h-2 w-2 shrink-0 rounded-full',
              session.status === 'active'
                ? 'bg-green-500'
                : 'bg-muted-foreground/60 dark:bg-muted-foreground/40',
            )}
          />
        )}
        {intent ? (
          <Tooltip>
            <TooltipTrigger asChild>{titleEl}</TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              {intentSource === 'auto'
                ? 'Auto-derived from first prompt — set with /intent'
                : 'Set via /intent'}
              {slug && <div className="mt-1 opacity-70">slug: {slug}</div>}
            </TooltipContent>
          </Tooltip>
        ) : (
          titleEl
        )}
        <div className="flex items-center gap-1.5 ml-auto shrink-0">
          {/* event count badge removed — counts are no longer
              denormalized on the session row. Re-add via
              GROUP BY or use-agents-derived counts when needed. */}
        </div>
      </div>
      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
        {showProject && projectName && (
          <span className="flex items-center gap-1 min-w-0">
            <Folder className="h-3 w-3 shrink-0" />
            <span className="truncate">{projectName}</span>
          </span>
        )}
        {showSlugSubline && (
          <span className="truncate text-muted-foreground/70 dark:text-muted-foreground/50">
            {slug}
          </span>
        )}
        {cwd && (
          <span className="truncate text-muted-foreground/80 dark:text-muted-foreground/60">
            {shortenCwd(cwd)}
          </span>
        )}
        <span className="flex items-center gap-1 ml-auto shrink-0">
          <Clock className="h-3 w-3" />
          {formatRelativeTime(lastTime)}
        </span>
      </div>
    </button>
  )
}
