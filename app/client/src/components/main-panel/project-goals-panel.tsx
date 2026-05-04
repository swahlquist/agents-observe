import { useState, useRef, useEffect } from 'react'
import { Plus, X, Check, Pencil, Target } from 'lucide-react'
import { useProjectGoals, useUpdateProjectGoals } from '@/hooks/use-project-goals'
import { useUIStore } from '@/stores/ui-store'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ProjectGoal, ProjectGoalWithLink } from '@/lib/api-client'

interface Props {
  projectId: number
}

function newGoalId(): string {
  // crypto.randomUUID is available in modern browsers + jsdom test env
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `g-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function stripLink(g: ProjectGoalWithLink): ProjectGoal {
  return { id: g.id, text: g.text, done: g.done }
}

export function ProjectGoalsPanel({ projectId }: Props) {
  const { data, isLoading } = useProjectGoals(projectId)
  const update = useUpdateProjectGoals(projectId)
  const [draft, setDraft] = useState('')
  const [collapsed, setCollapsed] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const goals = data?.goals ?? []
  const doneCount = goals.filter((g) => g.done).length

  function commit(next: ProjectGoal[]) {
    update.mutate(next)
  }

  function addGoal() {
    const text = draft.trim()
    if (!text) return
    commit([...goals.map(stripLink), { id: newGoalId(), text, done: false }])
    setDraft('')
    inputRef.current?.focus()
  }

  function toggleGoal(id: string) {
    commit(goals.map((g) => (g.id === id ? { ...stripLink(g), done: !g.done } : stripLink(g))))
  }

  function deleteGoal(id: string) {
    commit(goals.filter((g) => g.id !== id).map(stripLink))
  }

  function editGoal(id: string, text: string) {
    const trimmed = text.trim()
    if (!trimmed) {
      deleteGoal(id)
      return
    }
    commit(goals.map((g) => (g.id === id ? { ...stripLink(g), text: trimmed } : stripLink(g))))
  }

  // Hide entirely while loading on first mount so we don't flash an
  // empty panel above the session list.
  if (isLoading && !data) return null

  const hasGoals = goals.length > 0

  return (
    <div className="border-b border-border bg-muted/20">
      <div
        className="flex items-center gap-2 px-4 py-2 cursor-pointer select-none"
        onClick={() => setCollapsed((c) => !c)}
      >
        <Target className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium">Goals</span>
        {hasGoals && (
          <span className="text-[10px] text-muted-foreground">
            {doneCount} of {goals.length} done
          </span>
        )}
        <span className="ml-auto text-[10px] text-muted-foreground">
          {collapsed ? 'show' : 'hide'}
        </span>
      </div>
      {!collapsed && (
        <div className="px-4 pb-3 flex flex-col gap-1">
          {goals.map((g) => (
            <GoalRow
              key={g.id}
              goal={g}
              onToggle={() => toggleGoal(g.id)}
              onDelete={() => deleteGoal(g.id)}
              onEdit={(text) => editGoal(g.id, text)}
            />
          ))}
          <div className="flex items-center gap-2 mt-1">
            <Plus className="h-3 w-3 text-muted-foreground shrink-0" />
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addGoal()
                }
              }}
              placeholder="Add a goal..."
              className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/60"
            />
          </div>
        </div>
      )}
    </div>
  )
}

function GoalRow({
  goal,
  onToggle,
  onDelete,
  onEdit,
}: {
  goal: ProjectGoalWithLink
  onToggle: () => void
  onDelete: () => void
  onEdit: (text: string) => void
}) {
  const setSelectedSessionId = useUIStore((s) => s.setSelectedSessionId)
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(goal.text)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  function startEditing() {
    setEditValue(goal.text)
    setEditing(true)
  }

  function commitEdit() {
    setEditing(false)
    if (editValue.trim() !== goal.text) {
      onEdit(editValue)
    }
  }

  return (
    <div className="group flex items-center gap-2 text-xs">
      <Checkbox checked={goal.done} onCheckedChange={onToggle} />
      {editing ? (
        <input
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commitEdit()
            }
            if (e.key === 'Escape') {
              e.preventDefault()
              setEditValue(goal.text)
              setEditing(false)
            }
          }}
          className="flex-1 bg-transparent border border-border rounded px-1 outline-none"
        />
      ) : (
        <span
          className={cn(
            'flex-1 truncate cursor-text',
            goal.done && 'line-through text-muted-foreground',
          )}
          onClick={startEditing}
        >
          {goal.text}
        </span>
      )}
      {goal.linkedSessionId && !editing && (
        <button
          className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-700 dark:text-blue-300 hover:bg-blue-500/20 cursor-pointer truncate max-w-[160px]"
          title={goal.linkedSessionIntent ?? undefined}
          onClick={(e) => {
            e.stopPropagation()
            setSelectedSessionId(goal.linkedSessionId!)
          }}
        >
          {goal.linkedSessionSlug || goal.linkedSessionIntent || 'session'}
        </button>
      )}
      {!editing && (
        <Button
          variant="ghost"
          size="icon-xs"
          className="opacity-0 group-hover:opacity-100"
          title="Edit"
          onClick={startEditing}
        >
          <Pencil className="h-3 w-3 text-muted-foreground" />
        </Button>
      )}
      {editing ? (
        <Button variant="ghost" size="icon-xs" title="Save" onClick={commitEdit}>
          <Check className="h-3 w-3" />
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="icon-xs"
          className="opacity-0 group-hover:opacity-100 hover:text-destructive"
          title="Delete"
          onClick={onDelete}
        >
          <X className="h-3 w-3" />
        </Button>
      )}
    </div>
  )
}
