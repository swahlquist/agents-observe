import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SessionCard } from './session-card'
import type { RecentSession } from '@/types'

export interface FinishedTodayProps {
  sessions: RecentSession[]
  hideClientBadge?: boolean
  /**
   * When true, default the section to open (used when every visible
   * session is finished today and zero are active, per CONTEXT.md
   * "Empty states" branch 3).
   */
  forceOpen?: boolean
}

/**
 * Collapsed-by-default section listing sessions whose stoppedAt is
 * after local midnight today.
 */
export function FinishedToday({
  sessions,
  hideClientBadge = false,
  forceOpen = false,
}: FinishedTodayProps) {
  const [expanded, setExpanded] = useState(forceOpen)
  // Sync to forceOpen flips after mount. `useState(forceOpen)` only
  // honors the prop on the initial render, so a transition from
  // "active sessions exist" to "all sessions finished today" leaves
  // the section collapsed (CR-03) despite CONTEXT.md "Empty states"
  // branch 3 specifying it should auto-expand. We only force-expand
  // on a false-to-true flip; the user can still manually collapse it
  // after, and a back-to-false flip is treated as "do nothing" so we
  // don't fight the user's manual toggle.
  const lastForceOpenRef = useRef(forceOpen)
  useEffect(() => {
    if (forceOpen !== lastForceOpenRef.current) {
      lastForceOpenRef.current = forceOpen
      if (forceOpen) setExpanded(true)
    }
  }, [forceOpen])
  const count = sessions.length

  if (count === 0) return null

  return (
    <section className="border-b border-border" aria-label="Finished today">
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
        <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-sm font-medium">Finished today</span>
        <span className="ml-auto text-[10px] text-muted-foreground">{count}</span>
      </button>
      {expanded && (
        <div>
          {sessions.map((session) => (
            <SessionCard key={session.id} session={session} hideClientBadge={hideClientBadge} />
          ))}
        </div>
      )}
    </section>
  )
}
