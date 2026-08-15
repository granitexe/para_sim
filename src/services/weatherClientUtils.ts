import type { z } from 'zod'
import type { ResourceUnavailableReason } from '../domain/weather'
import {
  LocalRateLimitError,
  canonicalizeRequestUrl,
  retryAfterTime,
  type RequestScheduler,
} from './requestScheduler'

export class WeatherClientError extends Error {
  readonly reason: ResourceUnavailableReason
  readonly checkedAtMs: number
  readonly nextAllowedAtMs: number | null

  constructor(
    reason: ResourceUnavailableReason,
    message: string,
    checkedAtMs = Date.now(),
    nextAllowedAtMs: number | null = null,
  ) {
    super(message)
    this.name = 'WeatherClientError'
    this.reason = reason
    this.checkedAtMs = checkedAtMs
    this.nextAllowedAtMs = nextAllowedAtMs
  }
}

export interface ScheduledJson<T> {
  data: T
  fetchedAtMs: number
  sourceUrl: string
}

export async function requestScheduledJson<T>(
  scheduler: RequestScheduler,
  inputUrl: string | URL,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
): Promise<ScheduledJson<T>> {
  const sourceUrl = canonicalizeRequestUrl(inputUrl)
  const checkedAtMs = Date.now()
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new WeatherClientError('offline', 'The browser is offline.', checkedAtMs)
  }

  let response: Response
  try {
    response = await scheduler.enqueue(sourceUrl, signal)
  } catch (error) {
    if (error instanceof LocalRateLimitError) {
      throw new WeatherClientError(
        'local-rate-limit',
        error.message,
        checkedAtMs,
        error.nextAvailableAtMs,
      )
    }
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new WeatherClientError('aborted', 'The request was cancelled.', checkedAtMs)
    }
    if (error instanceof TypeError) {
      throw new WeatherClientError(
        'cors',
        'The provider request was blocked by CORS or the network.',
        checkedAtMs,
      )
    }
    throw new WeatherClientError('fetch-failure', 'The provider request failed.', checkedAtMs)
  }

  if (response.status === 429) {
    throw new WeatherClientError(
      'http-429',
      'The provider rate-limited this request.',
      checkedAtMs,
      retryAfterTime(response.headers.get('Retry-After'), checkedAtMs),
    )
  }
  if (!response.ok) {
    throw new WeatherClientError(
      'fetch-failure',
      `The provider returned HTTP ${response.status}.`,
      checkedAtMs,
    )
  }

  let raw: unknown
  try {
    raw = await response.json()
  } catch {
    throw new WeatherClientError('schema-mismatch', 'The provider returned invalid JSON.', checkedAtMs)
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    throw new WeatherClientError(
      'schema-mismatch',
      'The provider response did not match its expected schema.',
      checkedAtMs,
    )
  }
  return { data: parsed.data, fetchedAtMs: Date.now(), sourceUrl }
}

interface CacheEntry<T> {
  value: T
  expiresAtMs: number
}

export class MemorySuccessCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>()

  get(key: string, nowMs = Date.now()): T | null {
    const entry = this.entries.get(key)
    if (entry === undefined) return null
    if (entry.expiresAtMs <= nowMs) {
      this.entries.delete(key)
      return null
    }
    return entry.value
  }

  set(key: string, value: T, ttlMs: number, nowMs = Date.now()): void {
    this.entries.set(key, { value, expiresAtMs: nowMs + ttlMs })
  }

  delete(key: string): void {
    this.entries.delete(key)
  }

  clear(): void {
    this.entries.clear()
  }
}

export function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function normalizeDirection(
  value: unknown,
  warnings: string[],
  label: string,
): number | null {
  const finite = finiteOrNull(value)
  if (finite === null || finite < 0 || finite > 360) {
    if (value !== null && value !== undefined) warnings.push(`${label} contained an invalid direction.`)
    return null
  }
  return finite === 360 ? 0 : finite
}

export function normalizeNonnegative(
  value: unknown,
  warnings: string[],
  label: string,
): number | null {
  const finite = finiteOrNull(value)
  if (finite === null || finite < 0) {
    if (value !== null && value !== undefined) warnings.push(`${label} contained an invalid negative value.`)
    return null
  }
  return finite
}

export function normalizeHumidity(
  value: unknown,
  warnings: string[],
  label: string,
): number | null {
  const finite = finiteOrNull(value)
  if (finite === null || finite < 0 || finite > 100) {
    if (value !== null && value !== undefined) warnings.push(`${label} contained invalid humidity.`)
    return null
  }
  return finite
}
