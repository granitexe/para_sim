import { z } from 'zod'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RequestScheduler } from '../src/services/requestScheduler'
import { requestScheduledJson, WeatherClientError } from '../src/services/weatherClientUtils'

const schema = z.object({ value: z.number() })

afterEach(() => {
  vi.restoreAllMocks()
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
})

describe('scheduled weather JSON boundary', () => {
  it('maps malformed payloads to a source-specific schema state', async () => {
    const scheduler = new RequestScheduler({
      fetchImplementation: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ value: 'wrong' }), {
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    })
    await expect(
      requestScheduledJson(scheduler, 'https://example.test/weather', schema),
    ).rejects.toMatchObject({ reason: 'schema-mismatch' })
  })

  it('maps 429 with Retry-After without replaying the request', async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('{}', { status: 429, headers: { 'Retry-After': '60' } }),
    )
    const scheduler = new RequestScheduler({ fetchImplementation })
    const now = Date.now()
    await expect(
      requestScheduledJson(scheduler, 'https://example.test/weather', schema),
    ).rejects.toMatchObject({
      reason: 'http-429',
      nextAllowedAtMs: expect.closeTo(now + 60_000, -2),
    })
    expect(fetchImplementation).toHaveBeenCalledTimes(1)
  })

  it('returns offline without scheduling any request', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    const fetchImplementation = vi.fn<typeof fetch>()
    const scheduler = new RequestScheduler({ fetchImplementation })
    await expect(
      requestScheduledJson(scheduler, 'https://example.test/weather', schema),
    ).rejects.toMatchObject({ reason: 'offline' })
    expect(fetchImplementation).not.toHaveBeenCalled()
  })

  it('maps an opaque fetch TypeError to the CORS/network state', async () => {
    const scheduler = new RequestScheduler({
      fetchImplementation: vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch')),
    })
    const error = await requestScheduledJson(
      scheduler,
      'https://example.test/weather',
      schema,
    ).catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(WeatherClientError)
    expect(error).toMatchObject({ reason: 'cors' })
  })
})
