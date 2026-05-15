import { useEffect } from 'react'
import { useUIStore } from '@/stores/ui-store'

/** Web Audio bell tone parameters. */
const BELL_FREQUENCY_HZ = 800
const BELL_DURATION_MS = 150
const BELL_ATTACK_MS = 10
const BELL_RELEASE_MS = 50
const BELL_PEAK_GAIN = 0.2

// Module-scope state: persists across HomePage unmount/remount so the
// bell does NOT re-fire when the user navigates into a project and back
// while needsYou stays > 0 (CR-02). A useRef would reset on remount and
// the next render's useEffect would treat the still-pending count as a
// fresh false-to-true flip. A module-scope boolean is the minimum-touch
// mitigation; a cleaner long-term home is on ui-store, but that adds a
// rerender per flip and a localStorage round-trip we don't need.
let bellPrevHasNeeds = false

// Module-scope AudioContext (WR-02): one instance per browser tab,
// reused across remounts. Allocating a fresh context per HomePage mount
// burns through Chrome's 6-concurrent-AudioContext-per-tab budget and
// after that point `new Ctor()` throws and the catch swallows it
// silently, so the bell stops working with no signal.
let bellAudioContext: AudioContext | null = null

/**
 * Reset module-scope bell state. Test-only escape hatch so vitest can
 * exercise the false-to-true flip from a clean slate without
 * `vi.resetModules()`. Not exported on the public API surface in any
 * meaningful way (call sites in production code would defeat the
 * persistence behavior CR-02 fixes).
 */
export function __resetBellStateForTests(): void {
  bellPrevHasNeeds = false
  // Best-effort close; the AudioContext may still be in flight.
  bellAudioContext?.close().catch(() => {})
  bellAudioContext = null
}

/**
 * Side-effect hook: plays one short sine tone via Web Audio API on
 * every false-to-true flip of `needsYouCount > 0`. Does NOT replay
 * while count stays > 0; only re-fires after the count drops to 0 and
 * rises again. Respects the `bellEnabled` toggle from the UI store
 * (mute switch persists to localStorage under `agents-observe-bell`).
 *
 * The previous-state flag lives at module scope (CR-02) so HomePage
 * unmount/remount during navigation does not re-trigger the bell while
 * `needsYouCount` stays > 0. The AudioContext is also module-scope
 * (WR-02) so we don't allocate a fresh one on every remount and run
 * Chrome's 6-context-per-tab cap into the wall.
 *
 * Safe to call during SSR / pre-render: the hook is a no-op when
 * window.AudioContext is unavailable.
 */
export function useBell(needsYouCount: number): void {
  const bellEnabled = useUIStore((s) => s.bellEnabled)

  useEffect(() => {
    const hasNeeds = needsYouCount > 0
    const prevHasNeeds = bellPrevHasNeeds
    bellPrevHasNeeds = hasNeeds

    // Only fire on a false-to-true flip.
    if (!hasNeeds || prevHasNeeds) return
    if (!bellEnabled) return
    if (typeof window === 'undefined') return

    const Ctor =
      (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return

    try {
      if (!bellAudioContext) {
        bellAudioContext = new Ctor()
      }
      const ctx = bellAudioContext
      const now = ctx.currentTime
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = BELL_FREQUENCY_HZ
      osc.frequency.setValueAtTime(BELL_FREQUENCY_HZ, now)
      // Attack: ramp from 0 to peak gain over BELL_ATTACK_MS.
      gain.gain.setValueAtTime(0, now)
      gain.gain.linearRampToValueAtTime(BELL_PEAK_GAIN, now + BELL_ATTACK_MS / 1000)
      // Hold until the release segment.
      const releaseStart = now + (BELL_DURATION_MS - BELL_RELEASE_MS) / 1000
      gain.gain.setValueAtTime(BELL_PEAK_GAIN, releaseStart)
      gain.gain.linearRampToValueAtTime(0, now + BELL_DURATION_MS / 1000)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(now)
      osc.stop(now + BELL_DURATION_MS / 1000)
    } catch {
      // Web Audio failures are non-fatal; the bell is an enhancement.
    }
  }, [needsYouCount, bellEnabled])
}
