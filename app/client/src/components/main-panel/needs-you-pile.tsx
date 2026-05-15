import { useMemo } from 'react'
import { SessionCard } from './session-card'
import type { RecentSession } from '@/types'

export interface NeedsYouPileProps {
  sessions: RecentSession[]
  hideClientBadge?: boolean
}

/**
 * The top-of-home-view "Needs You" pile. Every entry in `sessions` is
 * expected to have `needsYou === true`; the parent component is
 * responsible for filtering.
 *
 * Sort order: most recent `lastActionAt` first, with null timestamps
 * treated as the oldest (sorted to the bottom).
 *
 * Empty state: a one-line subtle row using the verbatim string from
 * CONTEXT.md "Empty states".
 */
export function NeedsYouPile({ sessions, hideClientBadge = false }: NeedsYouPileProps) {
  const sorted = useMemo(
    () => [...sessions].sort((a, b) => (b.lastActionAt ?? 0) - (a.lastActionAt ?? 0)),
    [sessions],
  )

  if (sorted.length === 0) {
    return (
      <div className="px-4 py-2 text-xs text-muted-foreground/80 border-b border-border">
        All clear. Nothing needs you.
      </div>
    )
  }

  return (
    <section
      aria-label="Needs You"
      className="border-b border-border bg-amber-50/30 dark:bg-amber-950/10"
    >
      <header className="px-4 py-2 flex items-center gap-2">
        <span className="text-xs font-semibold text-amber-800 dark:text-amber-300">Needs You</span>
        <span className="text-[10px] text-muted-foreground">{sorted.length}</span>
      </header>
      <div>
        {sorted.map((session) => (
          <SessionCard key={session.id} session={session} hideClientBadge={hideClientBadge} />
        ))}
      </div>
    </section>
  )
}
