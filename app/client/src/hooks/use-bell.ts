import { useEffect, useRef } from 'react'
import { useUIStore } from '@/stores/ui-store'

/** Web Audio bell tone parameters. */
const BELL_FREQUENCY_HZ = 800
const BELL_DURATION_MS = 150
const BELL_ATTACK_MS = 10
const BELL_RELEASE_MS = 50
const BELL_PEAK_GAIN = 0.2

/**
 * Side-effect hook: plays one short sine tone via Web Audio API on
 * every false-to-true flip of `needsYouCount > 0`. Does NOT replay
 * while count stays > 0; only re-fires after the count drops to 0 and
 * rises again. Respects the `bellEnabled` toggle from the UI store
 * (mute switch persists to localStorage under `agents-observe-bell`).
 *
 * Safe to call during SSR / pre-render: the hook is a no-op when
 * window.AudioContext is unavailable.
 */
export function useBell(needsYouCount: number): void {
  const bellEnabled = useUIStore((s) => s.bellEnabled)
  // Track the previous "needs anything" boolean across renders. We use a
  // ref (not state) because the transition is detected in useEffect and
  // we never need to re-render on the change itself.
  const prevHasNeedsRef = useRef<boolean>(false)
  // Retain a single AudioContext instance across renders. Allocating a
  // new context per render triggers Chrome's "AudioContext was not
  // allowed to start" warnings on every flip; one persistent instance
  // survives the first user gesture and reuses the activation.
  const audioContextRef = useRef<AudioContext | null>(null)

  useEffect(() => {
    const hasNeeds = needsYouCount > 0
    const prevHasNeeds = prevHasNeedsRef.current
    prevHasNeedsRef.current = hasNeeds

    // Only fire on a false-to-true flip.
    if (!hasNeeds || prevHasNeeds) return
    if (!bellEnabled) return
    if (typeof window === 'undefined') return

    const Ctor =
      (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return

    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new Ctor()
      }
      const ctx = audioContextRef.current
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
