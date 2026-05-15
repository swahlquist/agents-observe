import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { useBell } from './use-bell'
import { useUIStore } from '@/stores/ui-store'

// Shared spy state across tests. Each test resets via beforeEach.
interface BellSpyState {
  createOscillatorCalls: number
  createGainCalls: number
  oscillators: Array<{
    frequency: { value: number; setValueAtTime: ReturnType<typeof vi.fn> }
    started: boolean
    stopped: boolean
    stopTime: number | null
    connect: ReturnType<typeof vi.fn>
    start: ReturnType<typeof vi.fn>
    stop: ReturnType<typeof vi.fn>
    type: OscillatorType
  }>
  gains: Array<{
    gain: { setValueAtTime: ReturnType<typeof vi.fn>; linearRampToValueAtTime: ReturnType<typeof vi.fn> }
    connect: ReturnType<typeof vi.fn>
  }>
  currentTime: number
}

const bellSpy: BellSpyState = {
  createOscillatorCalls: 0,
  createGainCalls: 0,
  oscillators: [],
  gains: [],
  currentTime: 0,
}

function makeMockAudioContextClass() {
  class MockAudioContext {
    currentTime = 0
    destination = {}
    state: AudioContextState = 'running'
    createOscillator() {
      bellSpy.createOscillatorCalls += 1
      const osc = {
        frequency: { value: 0, setValueAtTime: vi.fn() },
        type: 'sine' as OscillatorType,
        started: false,
        stopped: false,
        stopTime: null as number | null,
        connect: vi.fn(),
        start: vi.fn(function (this: typeof osc) {
          this.started = true
        }),
        stop: vi.fn(function (this: typeof osc, t?: number) {
          this.stopped = true
          this.stopTime = t ?? null
        }),
      }
      bellSpy.oscillators.push(osc)
      return osc
    }
    createGain() {
      bellSpy.createGainCalls += 1
      const gain = {
        gain: {
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn(),
      }
      bellSpy.gains.push(gain)
      return gain
    }
    resume() {
      return Promise.resolve()
    }
    close() {
      return Promise.resolve()
    }
  }
  return MockAudioContext as unknown as typeof AudioContext
}

beforeEach(() => {
  bellSpy.createOscillatorCalls = 0
  bellSpy.createGainCalls = 0
  bellSpy.oscillators = []
  bellSpy.gains = []
  bellSpy.currentTime = 0
  ;(window as unknown as { AudioContext: typeof AudioContext }).AudioContext =
    makeMockAudioContextClass()
  useUIStore.setState({ bellEnabled: true })
})

afterEach(() => {
  cleanup()
})

describe('useBell', () => {
  it('creates one oscillator on first false-to-true flip', () => {
    const { rerender } = renderHook(({ count }) => useBell(count), {
      initialProps: { count: 0 },
    })
    expect(bellSpy.createOscillatorCalls).toBe(0)

    rerender({ count: 1 })
    expect(bellSpy.createOscillatorCalls).toBe(1)
    expect(bellSpy.oscillators[0].started).toBe(true)
  })

  it('does not create an oscillator when bellEnabled is false', () => {
    act(() => {
      useUIStore.setState({ bellEnabled: false })
    })
    const { rerender } = renderHook(({ count }) => useBell(count), {
      initialProps: { count: 0 },
    })
    rerender({ count: 1 })
    rerender({ count: 2 })
    expect(bellSpy.createOscillatorCalls).toBe(0)
  })

  it('does not replay while count stays > 0 across renders', () => {
    const { rerender } = renderHook(({ count }) => useBell(count), {
      initialProps: { count: 0 },
    })
    rerender({ count: 1 })
    expect(bellSpy.createOscillatorCalls).toBe(1)
    rerender({ count: 2 })
    rerender({ count: 3 })
    rerender({ count: 1 })
    expect(bellSpy.createOscillatorCalls).toBe(1)
  })

  it('re-fires after count drops to 0 and rises again', () => {
    const { rerender } = renderHook(({ count }) => useBell(count), {
      initialProps: { count: 0 },
    })
    rerender({ count: 2 })
    expect(bellSpy.createOscillatorCalls).toBe(1)
    rerender({ count: 0 })
    expect(bellSpy.createOscillatorCalls).toBe(1)
    rerender({ count: 1 })
    expect(bellSpy.createOscillatorCalls).toBe(2)
  })

  it('sets oscillator frequency to 800 Hz', () => {
    const { rerender } = renderHook(({ count }) => useBell(count), {
      initialProps: { count: 0 },
    })
    rerender({ count: 1 })
    const osc = bellSpy.oscillators[0]
    // Either via the setter or a setValueAtTime call. Allow either.
    const viaSetter = osc.frequency.value === 800
    const viaSchedule = osc.frequency.setValueAtTime.mock.calls.some(([v]) => v === 800)
    expect(viaSetter || viaSchedule).toBe(true)
  })

  it('does not throw when AudioContext is unavailable', () => {
    // Simulate missing AudioContext (e.g. SSR / very old browser).
    const orig = (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext
    ;(window as unknown as { AudioContext?: typeof AudioContext }).AudioContext = undefined
    expect(() => {
      const { rerender } = renderHook(({ count }) => useBell(count), {
        initialProps: { count: 0 },
      })
      rerender({ count: 1 })
    }).not.toThrow()
    ;(window as unknown as { AudioContext?: typeof AudioContext }).AudioContext = orig
  })
})
