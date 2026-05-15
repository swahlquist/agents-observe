import { useEffect } from 'react'

const BASE_TITLE = 'agents-observe'
// U+00B7 middle dot. Intentional separator for the three-branch tab
// title format per CONTEXT.md "needsYou flip side effects (client)".
// Not an em dash; see CLAUDE.md hard rule.
const MIDDLE_DOT = '·'

/**
 * Side-effect hook: writes `document.title` per the three-branch format
 * dictated by Phase 1a CONTEXT.md.
 *
 * - count === 0       : "agents-observe"
 * - count === 1       : "(1) <topSessionIntent or 'needs you'> · agents-observe"
 * - count > 1         : "(<count>) sessions need you · agents-observe"
 *
 * Unconditional per CONTEXT.md (the bell has a mute toggle; the tab
 * title does not). Resets to the base title on unmount.
 */
export function useTabTitle(needsYouCount: number, topSessionIntent: string | null): void {
  useEffect(() => {
    let nextTitle: string
    if (needsYouCount <= 0) {
      nextTitle = BASE_TITLE
    } else if (needsYouCount === 1) {
      const label = topSessionIntent && topSessionIntent.length > 0 ? topSessionIntent : 'needs you'
      nextTitle = `(1) ${label} ${MIDDLE_DOT} ${BASE_TITLE}`
    } else {
      nextTitle = `(${needsYouCount}) sessions need you ${MIDDLE_DOT} ${BASE_TITLE}`
    }
    document.title = nextTitle
    return () => {
      document.title = BASE_TITLE
    }
  }, [needsYouCount, topSessionIntent])
}
