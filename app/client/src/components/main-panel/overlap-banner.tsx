import { useMemo } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useOverlaps } from '@/hooks/use-overlaps'
import { useUIStore } from '@/stores/ui-store'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { OverlapPair } from '@/lib/api-client'

interface OverlapBannerProps {
  /**
   * When set, only show pairs where at least one of the two sessions
   * belongs to this project. Used by the project page so a session in
   * project X overlapping with one in project Y still shows up on
   * either page.
   */
  projectId?: number | null
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function basename(path: string): string {
  const i = path.lastIndexOf('/')
  return i >= 0 ? path.slice(i + 1) : path
}

export function OverlapBanner({ projectId }: OverlapBannerProps) {
  const { data } = useOverlaps()

  const filtered = useMemo<OverlapPair[]>(() => {
    if (!data) return []
    if (projectId == null) return data.pairs
    return data.pairs.filter(
      (p) => p.sessionAProjectId === projectId || p.sessionBProjectId === projectId,
    )
  }, [data, projectId])

  if (filtered.length === 0) return null

  return (
    <div className="px-3 py-2 border-b border-border bg-amber-50 dark:bg-amber-950/30">
      <div className="flex items-center gap-2 mb-1.5">
        <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
        <span className="text-xs font-medium text-amber-900 dark:text-amber-200">
          {filtered.length === 1
            ? 'Two sessions are touching the same files'
            : `${filtered.length} session pairs are touching the same files`}
        </span>
      </div>
      <div className="flex flex-col gap-1">
        {filtered.map((pair) => (
          <OverlapRow key={`${pair.sessionA}|${pair.sessionB}`} pair={pair} />
        ))}
      </div>
    </div>
  )
}

function OverlapRow({ pair }: { pair: OverlapPair }) {
  const setSelectedProject = useUIStore((s) => s.setSelectedProject)
  const setSelectedSessionId = useUIStore((s) => s.setSelectedSessionId)

  const aLabel = pair.sessionAIntent || pair.sessionASlug || pair.sessionA.slice(0, 8)
  const bLabel = pair.sessionBIntent || pair.sessionBSlug || pair.sessionB.slice(0, 8)
  const firstFile = pair.files[0]
  const restCount = pair.files.length - 1
  const fileSummary =
    restCount > 0
      ? `${basename(firstFile.filePath)} and ${restCount} other${restCount === 1 ? '' : 's'}`
      : basename(firstFile.filePath)

  const navigate = (sessionId: string, projId: number | null) => {
    setSelectedProject(projId, null)
    setTimeout(() => setSelectedSessionId(sessionId), 0)
  }

  const fullFileList = pair.files.map((f) => f.filePath).join('\n')

  return (
    <div className="flex flex-wrap items-baseline gap-x-1 text-xs text-amber-900 dark:text-amber-200">
      <SessionLink
        label={aLabel}
        intentSource={pair.sessionAIntentSource}
        onClick={() => navigate(pair.sessionA, pair.sessionAProjectId)}
      />
      <span className="opacity-70">and</span>
      <SessionLink
        label={bLabel}
        intentSource={pair.sessionBIntentSource}
        onClick={() => navigate(pair.sessionB, pair.sessionBProjectId)}
      />
      <span className="opacity-70">are both editing</span>
      {restCount > 0 ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="font-mono text-[11px] underline decoration-dotted cursor-help">
              {fileSummary}
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs whitespace-pre-line max-w-sm">
            {fullFileList}
          </TooltipContent>
        </Tooltip>
      ) : (
        <span className="font-mono text-[11px]">{fileSummary}</span>
      )}
      <span className="opacity-60 ml-1">({formatRelative(pair.lastTouchedAt)})</span>
    </div>
  )
}

function SessionLink({
  label,
  intentSource,
  onClick,
}: {
  label: string
  intentSource: 'manual' | 'auto' | null
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'font-medium underline decoration-dotted hover:decoration-solid cursor-pointer',
        intentSource === 'auto' && 'italic opacity-90',
      )}
    >
      &ldquo;{label}&rdquo;
    </button>
  )
}
