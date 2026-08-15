import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  canonicalizeRequestUrl,
  LocalRateLimitError,
  RequestScheduler,
  retryAfterTime,
} from '../src/services/requestScheduler'

describe('RequestScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('deduplicates canonical URLs and gives each consumer a readable response clone', async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ value: 1 }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const scheduler = new RequestScheduler({ fetchImplementation })
    const first = scheduler.enqueue('https://weather.example/data?b=2&a=1')
    const second = scheduler.enqueue('https://weather.example/data?a=1&b=2')
    await vi.runAllTimersAsync()

    expect(fetchImplementation).toHaveBeenCalledTimes(1)
    expect(await (await first).json()).toEqual({ value: 1 })
    expect(await (await second).json()).toEqual({ value: 1 })
    expect(fetchImplementation.mock.calls[0]![0]).toBe('https://weather.example/data?a=1&b=2')
  })

  it('starts FIFO at least 250 ms apart and no more than four times per rolling second', async () => {
    const starts: number[] = []
    const fetchImplementation = vi.fn<typeof fetch>().mockImplementation(async () => {
      starts.push(Date.now())
      return new Response('{}')
    })
    const scheduler = new RequestScheduler({ fetchImplementation })
    const requests = Array.from({ length: 5 }, (_, index) =>
      scheduler.enqueue(`https://weather.example/${index}`),
    )

    expect(starts).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(249)
    expect(starts).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(starts).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(750)
    expect(starts).toHaveLength(5)
    expect(starts.map((time) => time - starts[0]!)).toEqual([0, 250, 500, 750, 1000])
    await Promise.all(requests)
  })

  it('removes aborted queued work without sending it', async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}'))
    const scheduler = new RequestScheduler({ fetchImplementation })
    const first = scheduler.enqueue('https://weather.example/first')
    const controller = new AbortController()
    const queued = scheduler.enqueue('https://weather.example/queued', controller.signal)
    controller.abort()

    await expect(queued).rejects.toMatchObject({ name: 'AbortError' })
    await vi.runAllTimersAsync()
    await first
    expect(fetchImplementation).toHaveBeenCalledTimes(1)
  })

  it('blocks new starts for a valid Retry-After without replaying the 429', async () => {
    const starts: number[] = []
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(async () => {
        starts.push(Date.now())
        return new Response('{}', { status: 429, headers: { 'Retry-After': '2' } })
      })
      .mockImplementationOnce(async () => {
        starts.push(Date.now())
        return new Response('{}')
      })
    const scheduler = new RequestScheduler({ fetchImplementation })
    const limited = scheduler.enqueue('https://weather.example/limited')
    await vi.advanceTimersByTimeAsync(0)
    const next = scheduler.enqueue('https://weather.example/next')
    await vi.advanceTimersByTimeAsync(1999)
    expect(fetchImplementation).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchImplementation).toHaveBeenCalledTimes(2)
    expect(starts[1]! - starts[0]!).toBe(2000)
    expect((await limited).status).toBe(429)
    expect((await next).status).toBe(200)
  })

  it('refuses the 201st hourly start locally with the next available time', async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}'))
    const scheduler = new RequestScheduler({ fetchImplementation })
    const accepted = Array.from({ length: 200 }, (_, index) =>
      scheduler.enqueue(`https://weather.example/hour/${index}`),
    )
    const refused = scheduler.enqueue('https://weather.example/hour/refused')
    const refusalExpectation = expect(refused).rejects.toBeInstanceOf(LocalRateLimitError)
    await vi.advanceTimersByTimeAsync(50_000)
    await Promise.all(accepted)
    await refusalExpectation
    expect(fetchImplementation).toHaveBeenCalledTimes(200)
    await expect(refused).rejects.toMatchObject({
      kind: 'local-rate-limit',
      nextAvailableAtMs: Date.parse('2026-01-01T13:00:00Z'),
    })
  })
})

describe('request URL and Retry-After parsing', () => {
  it('canonicalizes query order and drops fragments', () => {
    expect(canonicalizeRequestUrl('https://example.test/path?z=2&a=1#private')).toBe(
      'https://example.test/path?a=1&z=2',
    )
  })

  it('accepts delta seconds and future HTTP dates only', () => {
    const now = Date.parse('2026-01-01T12:00:00Z')
    expect(retryAfterTime('1.5', now)).toBe(now + 1500)
    expect(retryAfterTime('Thu, 01 Jan 2026 12:01:00 GMT', now)).toBe(now + 60_000)
    expect(retryAfterTime('bad', now)).toBeNull()
    expect(retryAfterTime('Thu, 01 Jan 2026 11:59:00 GMT', now)).toBeNull()
  })
})
