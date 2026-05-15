import { useState } from 'react'
import { ChevronDown, ChevronRight, Folder } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SessionCard } from './session-card'
import type { RecentSession } from '@/types'

export interface ProjectGroupProps {
  projectId: number | null
  projectName: string
  projectSlug: string | null
  activeSessions: RecentSession[]
  finishedTodaySessions: RecentSession[]
  hideClientBadge?: boolean
}

/**
 * Collapsible per-project group. Header shows project name plus active
 * and finished-today counts. Expanded by default in Phase 1a (no
 * persistence; deferred to Phase 1b per CONTEXT.md).
 */
export function ProjectGroup({
  projectName,
  activeSessions,
  finishedTodaySessions,
  hideClientBadge = false,
}: ProjectGroupProps) {
  const [expanded, setExpanded] = useState(true)
  const activeCount = activeSessions.length
  const finishedCount = finishedTodaySessions.length

  return (
    <section className="border-b border-border" aria-label={`Project ${projectName}`}>
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className={cn(
          'w-full flex items-center gap-2 px-4 py-2 text-left',
          'hover:bg-accent/40 transition-colors cursor-pointer',
          'focus:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        )}
        aria-expanded={expanded}
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        )}
        <Folder className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-sm font-medium truncate">{projectName}</span>
        <span className="ml-auto flex items-center gap-2 text-[10px] text-muted-foreground">
          <span title={`${activeCount} active`}>{activeCount} active</span>
          {finishedCount > 0 && (
            <span title={`${finishedCount} finished today`}>{finishedCount} finished today</span>
          )}
        </span>
      </button>
      {expanded && activeCount > 0 && (
        <div>
          {activeSessions.map((session) => (
            <SessionCard key={session.id} session={session} hideClientBadge={hideClientBadge} />
          ))}
        </div>
      )}
    </section>
  )
}
