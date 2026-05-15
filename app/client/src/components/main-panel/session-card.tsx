import { useMemo } from 'react'
import {
  Wrench,
  Sparkles,
  BookOpen,
  Rocket,
  Brush,
  FlaskConical,
  Terminal,
  Clock,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/stores/ui-store'
import { useSessionPulseActive } from '@/hooks/use-pulse-active'
import type { RecentSession, SessionStatus } from '@/types'

/**
 * Eight LingoLinq-safe color stripe palette. Phase 1a uses a stable
 * hash of `session_id` to pick an index; Phase 1b moves to a stored
 * `sessions.color` column.
 */
const STRIPE_COLORS: ReadonlyArray<string> = [
  'bg-sky-400',
  'bg-emerald-400',
  'bg-amber-400',
  'bg-violet-400',
  'bg-rose-400',
  'bg-teal-400',
  'bg-indigo-400',
  'bg-fuchsia-400',
]

/**
 * FNV-1a 32-bit hash. Deterministic, ASCII-safe, and good enough for
 * picking a stripe color from a session id. Math.random is not used:
 * the same session must always land on the same color across reloads
 * and across tabs.
 */
function fnv1a32(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    // 32-bit FNV prime multiplication via shifts (keeps numbers in i32).
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0
  }
  return hash >>> 0
}

/** Returns 0..7 from a stable hash of the session id. */
export function colorStripeIndex(sessionId: string): number {
  return fnv1a32(sessionId) % STRIPE_COLORS.length
}

/**
 * Map an intent string to a lucide-react icon. Keyword-matched in the
 * order listed in CONTEXT.md "Card visuals". Match is case-insensitive
 * substring (so "doc" hits "document", "audit" hits "auditing", etc.).
 * Fallback is `Terminal`.
 */
const ICON_KEYWORDS: ReadonlyArray<[ReadonlyArray<string>, LucideIcon]> = [
  [['fix', 'bug', 'repair', 'broken'], Wrench],
  [['feat', 'add', 'build', 'implement', 'new'], Sparkles],
  [['doc', 'audit', 'explain', 'understand', 'walk'], BookOpen],
  [['deploy', 'release', 'ship', 'push'], Rocket],
  [['refactor', 'clean', 'tidy'], Brush],
  [['test', 'spec'], FlaskConical],
]

export function categoryIcon(intent: string | null | undefined): LucideIcon {
  if (!intent) return Terminal
  const text = intent.toLowerCase()
  for (const [keywords, icon] of ICON_KEYWORDS) {
    for (const kw of keywords) {
      if (text.includes(kw)) return icon
    }
  }
  return Terminal
}

export interface StatusBadgeDescriptor {
  label: string
  className: string
}

/**
 * Visual descriptor map keyed by the six-state SessionStatus union.
 * Exported so the SessionView Overview tab can reuse the same palette
 * without duplicating the colors (extract to a shared module if a third
 * consumer arrives).
 */
export const STATUS_BADGE: Record<SessionStatus, StatusBadgeDescriptor> = {
  WORKING: {
    label: 'Working',
    className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  },
  WAITING_FOR_INPUT: {
    label: 'Waiting for input',
    className: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  },
  WAITING_ON_PERMISSION: {
    label: 'Waiting on permission',
    className: 'bg-red-500/15 text-red-700 dark:text-red-300',
  },
  IDLE: {
    label: 'Idle',
    className: 'bg-muted text-muted-foreground',
  },
  FINISHED: {
    label: 'Finished',
    className: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  },
  ABANDONED: {
    label: 'Abandoned',
    className: 'bg-muted/60 text-muted-foreground/70 opacity-80',
  },
}

/** Format an elapsed time delta (ms) into a compact "Xm" / "Xh" / "Xd" string. */
function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0m'
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d`
  return `${Math.floor(days / 30)}mo`
}

/** Format a wall-clock ts into a relative "Xm ago" / "Xh ago" string. */
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

/**
 * Build the badge label for a session, splicing in per-state context:
 * WAITING_ON_PERMISSION appends the tool name from `statusDetail`;
 * IDLE appends elapsed time computed from `lastActivity`.
 */
export function buildStatusBadgeLabel(session: RecentSession, now: number = Date.now()): string {
  const base = STATUS_BADGE[session.derivedStatus]
  if (!base) return ''
  if (session.derivedStatus === 'WAITING_ON_PERMISSION' && session.statusDetail) {
    return `Waiting on ${session.statusDetail}`
  }
  if (session.derivedStatus === 'IDLE') {
    const elapsed = formatElapsed(now - session.lastActivity)
    return `Idle ${elapsed}`
  }
  return base.label
}

/** Derive "claude" / "gemini" client badge text from agentClasses[0]. */
function clientBadgeText(agentClasses: string[]): string | null {
  if (!agentClasses.length) return null
  const first = agentClasses[0].toLowerCase()
  if (first.includes('gemini')) return 'gemini'
  if (first.includes('claude')) return 'claude'
  return first
}

export interface SessionCardProps {
  session: RecentSession
  /** When true (single-client mode), hide the client badge entirely. */
  hideClientBadge?: boolean
}

export function SessionCard({ session, hideClientBadge = false }: SessionCardProps) {
  const selectProjectSession = useUIStore((s) => s.selectProjectSession)
  const pulseActive = useSessionPulseActive(session.id)

  const stripeClass = STRIPE_COLORS[colorStripeIndex(session.id)]
  const Icon = useMemo(() => categoryIcon(session.intent), [session.intent])
  const badge = STATUS_BADGE[session.derivedStatus] ?? STATUS_BADGE.IDLE
  const badgeLabel = buildStatusBadgeLabel(session)
  const client = hideClientBadge ? null : clientBadgeText(session.agentClasses)

  const handleClick = () => {
    // WR-06: one atomic ui-store update for project + session so we do
    // not depend on a `setTimeout(..., 0)` to sneak the session-id
    // setter past setSelectedProject's `selectedSessionId: null` clear.
    selectProjectSession(session.projectId, session.projectSlug ?? null, session.id)
  }

  const intentTitle = session.intent || session.slug || session.id.slice(0, 8)
  const lastActionLabel = session.lastActionLabel
  const lastActionAt = session.lastActionAt ?? session.lastActivity

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        'group relative w-full text-left flex items-stretch gap-3 pr-3 py-2.5',
        'border-b border-border hover:bg-accent/40 transition-colors cursor-pointer',
        'focus:outline-none focus-visible:ring-1 focus-visible:ring-ring',
      )}
    >
      <span className={cn('w-[3px] shrink-0 rounded-r-sm', stripeClass)} aria-hidden="true" />
      <span className="flex items-center justify-center w-6 h-6 mt-0.5 shrink-0 text-muted-foreground">
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1 flex flex-col gap-1">
        <span className="text-sm font-medium truncate">{intentTitle}</span>
        <span className="flex items-center gap-2 text-xs text-muted-foreground min-w-0">
          <span
            className={cn(
              'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium',
              badge.className,
            )}
          >
            <span
              className={cn(
                'inline-block h-1.5 w-1.5 rounded-full bg-current opacity-70',
                pulseActive && 'animate-pulse opacity-100',
              )}
              aria-hidden="true"
            />
            {badgeLabel}
          </span>
          {lastActionLabel && (
            <span className="truncate text-muted-foreground/80">{lastActionLabel}</span>
          )}
          <span className="flex items-center gap-1 ml-auto shrink-0 text-muted-foreground/70">
            <Clock className="h-3 w-3" />
            {formatRelativeTime(lastActionAt)}
          </span>
        </span>
      </span>
      {client && (
        <span className="self-center shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
          {client}
        </span>
      )}
    </button>
  )
}
