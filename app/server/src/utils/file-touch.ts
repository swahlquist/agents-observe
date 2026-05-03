/**
 * Pull the file path(s) a tool event touched, for the overlap-detection
 * pipeline. Returns an array (most events are 1:1 but MultiEdit can hit
 * many) or null when nothing recognizable is found.
 *
 * Keeps the agent-class branching small on purpose: Claude Code is the
 * dominant case and uses `tool_input.file_path` / `tool_input.notebook_path`.
 * Other agent classes can be added here as their payload shapes are
 * confirmed; until then they silently contribute zero overlap signal,
 * which is the right failure mode (no false positives).
 */
export function extractTouchedPaths(
  agentClass: string | null | undefined,
  hookName: string,
  payload: unknown,
): string[] {
  if (hookName !== 'PreToolUse' && hookName !== 'PostToolUse') return []
  if (!payload || typeof payload !== 'object') return []
  const p = payload as Record<string, unknown>
  const toolName = typeof p.tool_name === 'string' ? p.tool_name : null
  const toolInput =
    p.tool_input && typeof p.tool_input === 'object'
      ? (p.tool_input as Record<string, unknown>)
      : null
  if (!toolName || !toolInput) return []
  // Claude Code is the only confirmed shape so far. Codex routes through
  // a different envelope and isn't wired in yet.
  if (agentClass !== 'claude-code') return []

  switch (toolName) {
    case 'Read':
    case 'Edit':
    case 'Write': {
      const fp = toolInput.file_path
      return typeof fp === 'string' && fp ? [fp] : []
    }
    case 'NotebookEdit': {
      const np = toolInput.notebook_path
      return typeof np === 'string' && np ? [np] : []
    }
    default:
      return []
  }
}
