import { describe, test, expect, vi, beforeEach } from 'vitest'
import { postOutgoingWebhook, type OutgoingWebhookPayload } from './outgoing-webhook'

const basePayload: OutgoingWebhookPayload = {
  type: 'session_start',
  ts: 1700000000000,
  sessionId: 'sA',
  sessionSlug: 'twinkly-dragon',
  intent: 'Refactor auth',
  intentSource: 'manual',
  projectId: 1,
  projectSlug: 'agents-observe',
  projectName: 'Agents Observe',
}

describe('postOutgoingWebhook', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  test('returns false and skips fetch when url is empty', () => {
    const fetchImpl = vi.fn()
    const sent = postOutgoingWebhook(basePayload, { url: '', fetchImpl })
    expect(sent).toBe(false)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  test('posts JSON body to the configured url and returns true', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 } as unknown as Response)
    const sent = postOutgoingWebhook(basePayload, {
      url: 'https://example.test/hook',
      fetchImpl,
    })
    expect(sent).toBe(true)
    await new Promise((r) => setImmediate(r))
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://example.test/hook')
    expect((init as RequestInit).method).toBe('POST')
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers['Content-Type']).toBe('application/json')
    expect(headers['User-Agent']).toMatch(/^agents-observe\//)
    expect(headers['X-Observe-Secret']).toBeUndefined()
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body).toMatchObject({
      type: 'session_start',
      sessionId: 'sA',
      projectSlug: 'agents-observe',
    })
  })

  test('attaches X-Observe-Secret header when secret configured', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 } as unknown as Response)
    postOutgoingWebhook(basePayload, {
      url: 'https://example.test/hook',
      secret: 's3cret',
      fetchImpl,
    })
    await new Promise((r) => setImmediate(r))
    const init = fetchImpl.mock.calls[0][1] as RequestInit
    const headers = init.headers as Record<string, string>
    expect(headers['X-Observe-Secret']).toBe('s3cret')
  })

  test('swallows fetch rejections without surfacing', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetchImpl = vi.fn().mockRejectedValue(new Error('connection refused'))
    expect(() =>
      postOutgoingWebhook(basePayload, {
        url: 'https://example.test/hook',
        fetchImpl,
      }),
    ).not.toThrow()
    await new Promise((r) => setImmediate(r))
    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('connection refused'))
  })

  test('logs a warning on non-2xx responses', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500 } as unknown as Response)
    postOutgoingWebhook(basePayload, {
      url: 'https://example.test/hook',
      fetchImpl,
    })
    await new Promise((r) => setImmediate(r))
    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('-> 500'))
  })
})
