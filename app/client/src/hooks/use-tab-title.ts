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
 * title does not).
 *
 * No cleanup function: React invokes the cleanup not only on unmount
 * but between every dependency-change run, which would briefly flash
 * the base title on every count/intent change. On unmount we want the
 * indicator to persist (the user navigates into a project but sessions
 * still need them; the tab indicator is the only signal). The next
 * effect run writes the correct title; the count-zero branch above
 * writes BASE_TITLE explicitly when everything is clear. A global
 * title reset on app teardown, if ever needed, belongs at the app root.
 * See CR-01 in the Phase 01A code review.
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
  }, [needsYouCount, topSessionIntent])
}
