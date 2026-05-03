/**
 * Pull a short, single-line snippet out of a hook payload for use as
 * the auto-derived session intent. Tried field names cover Claude
 * Code, Codex, and any future agent class that might shape the prompt
 * differently. Returns null when nothing usable is found.
 *
 * Behavior:
 *   - Collapse whitespace (newlines, tabs, runs of spaces) to single spaces.
 *   - Trim.
 *   - Truncate to 60 chars with an ellipsis when longer, so the
 *     dashboard row stays readable.
 */
export function extractPromptSnippet(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const p = payload as Record<string, unknown>
  // Try the common shapes in priority order.
  const candidates = [p.prompt, p.user_prompt, p.userPrompt, p.text, p.message, p.content]
  for (const c of candidates) {
    if (typeof c !== 'string') continue
    const collapsed = c.replace(/\s+/g, ' ').trim()
    if (!collapsed) continue
    return collapsed.length > 60 ? collapsed.slice(0, 57).trimEnd() + '...' : collapsed
  }
  return null
}
