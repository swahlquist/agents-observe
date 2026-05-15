import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderHook, cleanup } from '@testing-library/react'
import { useTabTitle } from './use-tab-title'

// U+2014 EM DASH constructed via codepoint so the source file itself
// contains zero em dash characters (CLAUDE.md hard rule).
const EM_DASH = String.fromCodePoint(0x2014)

beforeEach(() => {
  document.title = 'previous-title'
})

afterEach(() => {
  cleanup()
})

describe('useTabTitle', () => {
  it('sets the base title when count is 0', () => {
    renderHook(() => useTabTitle(0, null))
    expect(document.title).toBe('agents-observe')
  })

  it('formats the N=1 branch with the top session intent and the middle dot', () => {
    renderHook(() => useTabTitle(1, 'fix login bug'))
    // U+00B7 middle dot, single-space padded.
    expect(document.title).toBe('(1) fix login bug · agents-observe')
    expect(document.title).toContain('·')
    // No em dash anywhere.
    expect(document.title.includes(EM_DASH)).toBe(false)
  })

  it('falls back to "needs you" when N=1 and intent is null or empty', () => {
    const { rerender } = renderHook(
      ({ n, intent }: { n: number; intent: string | null }) => useTabTitle(n, intent),
      { initialProps: { n: 1, intent: null } },
    )
    expect(document.title).toBe('(1) needs you · agents-observe')

    rerender({ n: 1, intent: '' })
    expect(document.title).toBe('(1) needs you · agents-observe')
  })

  it('formats the N>1 branch as "(N) sessions need you (mdot) agents-observe"', () => {
    renderHook(() => useTabTitle(3, 'fix login bug'))
    expect(document.title).toBe('(3) sessions need you · agents-observe')
    expect(document.title).toContain('·')
    expect(document.title.includes(EM_DASH)).toBe(false)
  })

  it('updates the title when count or intent changes', () => {
    const { rerender } = renderHook(
      ({ n, intent }: { n: number; intent: string | null }) => useTabTitle(n, intent),
      { initialProps: { n: 0, intent: null } },
    )
    expect(document.title).toBe('agents-observe')
    rerender({ n: 1, intent: 'do thing' })
    expect(document.title).toBe('(1) do thing · agents-observe')
    rerender({ n: 5, intent: 'do thing' })
    expect(document.title).toBe('(5) sessions need you · agents-observe')
    rerender({ n: 0, intent: null })
    expect(document.title).toBe('agents-observe')
  })

  it('resets to the base title on unmount', () => {
    const { unmount } = renderHook(() => useTabTitle(2, 'something'))
    expect(document.title).toContain('sessions need you')
    unmount()
    expect(document.title).toBe('agents-observe')
  })
})
