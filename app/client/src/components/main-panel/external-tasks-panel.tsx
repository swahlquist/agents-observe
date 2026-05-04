import { useState } from 'react'
import { ListTodo, ExternalLink, AlertCircle } from 'lucide-react'
import { useExternalTasks } from '@/hooks/use-external-tasks'
import { cn } from '@/lib/utils'

/**
 * Today's Notion tasks shown above the recent-sessions list. Hides
 * itself entirely when the Notion bridge is unconfigured so users who
 * never set it up never see an empty hint.
 */
export function ExternalTasksPanel() {
  const { data, isLoading, isError } = useExternalTasks()
  const [collapsed, setCollapsed] = useState(false)

  if (isLoading || isError) return null
  if (!data?.configured) return null

  const tasks = data.tasks
  const hasTasks = tasks.length > 0

  return (
    <div className="border-b border-border bg-muted/20">
      <div
        className="flex items-center gap-2 px-4 py-2 cursor-pointer select-none"
        onClick={() => setCollapsed((c) => !c)}
      >
        <ListTodo className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium">Today</span>
        <span className="text-[10px] text-muted-foreground">
          {hasTasks ? `${tasks.length} from Notion` : 'no tasks'}
        </span>
        <span className="ml-auto text-[10px] text-muted-foreground">
          {collapsed ? 'show' : 'hide'}
        </span>
      </div>
      {!collapsed && hasTasks && (
        <div className="px-4 pb-3 flex flex-col gap-1">
          {tasks.map((t) => (
            <TaskRow key={t.id} title={t.title} url={t.url} status={t.status} dueAt={t.dueAt} />
          ))}
        </div>
      )}
      {!collapsed && !hasTasks && (
        <div className="px-4 pb-3 flex items-center gap-2 text-[11px] text-muted-foreground">
          <AlertCircle className="h-3 w-3" />
          Nothing scheduled for today.
        </div>
      )}
    </div>
  )
}

interface TaskRowProps {
  title: string
  url: string | null
  status: string | null
  dueAt: string | null
}

function isOverdue(dueAt: string | null): boolean {
  if (!dueAt) return false
  // Notion date strings are 'YYYY-MM-DD' (or full ISO). Take date part
  // and compare against today's local date so we don't trip on tz drift.
  const due = dueAt.slice(0, 10)
  const today = new Date().toISOString().slice(0, 10)
  return due < today
}

function TaskRow({ title, url, status, dueAt }: TaskRowProps) {
  const overdue = isOverdue(dueAt)
  const Wrapper = url ? 'a' : 'div'
  const wrapperProps = url
    ? {
        href: url,
        target: '_blank',
        rel: 'noopener noreferrer',
      }
    : {}

  return (
    <Wrapper
      {...wrapperProps}
      className={cn(
        'group flex items-center gap-2 text-xs',
        url && 'cursor-pointer hover:text-foreground',
      )}
    >
      <span className="flex-1 truncate">{title}</span>
      {dueAt && (
        <span
          className={cn(
            'shrink-0 text-[10px]',
            overdue ? 'text-destructive' : 'text-muted-foreground',
          )}
          title={overdue ? 'Overdue' : 'Due'}
        >
          {dueAt.slice(0, 10)}
        </span>
      )}
      {status && (
        <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
          {status}
        </span>
      )}
      {url && (
        <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0" />
      )}
    </Wrapper>
  )
}
