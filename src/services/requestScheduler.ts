export class LocalRateLimitError extends Error {
  readonly kind = 'local-rate-limit' as const
  readonly nextAvailableAtMs: number

  constructor(nextAvailableAtMs: number) {
    super('The local weather-request budget is exhausted.')
    this.name = 'LocalRateLimitError'
    this.nextAvailableAtMs = nextAvailableAtMs
  }
}

interface Subscriber {
  resolve: (response: Response) => void
  reject: (reason: unknown) => void
  signal: AbortSignal | undefined
  abortListener: (() => void) | null
  settled: boolean
}

interface QueueEntry {
  url: string
  subscribers: Subscriber[]
  controller: AbortController
  started: boolean
}

export interface RequestSchedulerOptions {
  fetchImplementation?: typeof fetch
  now?: () => number
}

const oneSecondMs = 1_000
const oneHourMs = 60 * 60 * 1_000
const minimumStartSpacingMs = 250
const startsPerSecond = 4
const startsPerHour = 200

export function canonicalizeRequestUrl(input: string | URL): string {
  const url = new URL(input.toString())
  url.searchParams.sort()
  url.hash = ''
  return url.href
}

export function retryAfterTime(header: string | null, nowMs: number): number | null {
  if (header === null) return null
  const trimmed = header.trim()
  if (/^\d+(?:\.\d+)?$/u.test(trimmed)) {
    const seconds = Number(trimmed)
    return Number.isFinite(seconds) ? nowMs + Math.max(0, seconds * 1_000) : null
  }
  const timestamp = Date.parse(trimmed)
  return Number.isFinite(timestamp) && timestamp > nowMs ? timestamp : null
}

export class RequestScheduler {
  private readonly fetchImplementation: typeof fetch
  private readonly now: () => number
  private readonly queue: QueueEntry[] = []
  private readonly entriesByUrl = new Map<string, QueueEntry>()
  private readonly startTimesMs: number[] = []
  private timer: number | null = null
  private lastStartMs = Number.NEGATIVE_INFINITY
  private blockedUntilMs = 0

  constructor(options: RequestSchedulerOptions = {}) {
    this.fetchImplementation = options.fetchImplementation ?? globalThis.fetch.bind(globalThis)
    this.now = options.now ?? Date.now
  }

  enqueue(inputUrl: string | URL, signal?: AbortSignal): Promise<Response> {
    const url = canonicalizeRequestUrl(inputUrl)
    let entry = this.entriesByUrl.get(url)
    if (entry === undefined) {
      entry = {
        url,
        subscribers: [],
        controller: new AbortController(),
        started: false,
      }
      this.entriesByUrl.set(url, entry)
      this.queue.push(entry)
    }

    const promise = new Promise<Response>((resolve, reject) => {
      const subscriber: Subscriber = {
        resolve,
        reject,
        signal,
        abortListener: null,
        settled: false,
      }
      entry!.subscribers.push(subscriber)
      if (signal?.aborted === true) {
        this.abortSubscriber(entry!, subscriber)
        return
      }
      if (signal !== undefined) {
        subscriber.abortListener = () => this.abortSubscriber(entry!, subscriber)
        signal.addEventListener('abort', subscriber.abortListener, { once: true })
      }
    })
    this.pump()
    return promise
  }

  private abortSubscriber(entry: QueueEntry, subscriber: Subscriber): void {
    if (subscriber.settled) return
    subscriber.settled = true
    if (subscriber.abortListener !== null && subscriber.signal !== undefined) {
      subscriber.signal.removeEventListener('abort', subscriber.abortListener)
    }
    subscriber.reject(new DOMException('The request was aborted.', 'AbortError'))
    if (entry.subscribers.every((candidate) => candidate.settled)) {
      if (entry.started) entry.controller.abort()
      else this.removeQueuedEntry(entry)
    }
  }

  private removeQueuedEntry(entry: QueueEntry): void {
    const index = this.queue.indexOf(entry)
    if (index >= 0) this.queue.splice(index, 1)
    if (this.entriesByUrl.get(entry.url) === entry) this.entriesByUrl.delete(entry.url)
    this.pump()
  }

  private pruneStarts(nowMs: number): void {
    while (this.startTimesMs.length > 0 && this.startTimesMs[0]! <= nowMs - oneHourMs) {
      this.startTimesMs.shift()
    }
  }

  private nextStartTime(nowMs: number): number {
    let next = Math.max(this.blockedUntilMs, this.lastStartMs + minimumStartSpacingMs)
    const recentSecond = this.startTimesMs.filter((time) => time > nowMs - oneSecondMs)
    if (recentSecond.length >= startsPerSecond) {
      next = Math.max(next, recentSecond[recentSecond.length - startsPerSecond]! + oneSecondMs)
    }
    return next
  }

  private rejectEntry(entry: QueueEntry, reason: unknown): void {
    for (const subscriber of entry.subscribers) {
      if (subscriber.settled) continue
      subscriber.settled = true
      if (subscriber.abortListener !== null && subscriber.signal !== undefined) {
        subscriber.signal.removeEventListener('abort', subscriber.abortListener)
      }
      subscriber.reject(reason)
    }
    if (this.entriesByUrl.get(entry.url) === entry) this.entriesByUrl.delete(entry.url)
  }

  private pump(): void {
    if (this.timer !== null) return
    while (this.queue.length > 0 && this.queue[0]!.subscribers.every((subscriber) => subscriber.settled)) {
      const abandoned = this.queue.shift()!
      if (this.entriesByUrl.get(abandoned.url) === abandoned) this.entriesByUrl.delete(abandoned.url)
    }
    const entry = this.queue[0]
    if (entry === undefined) return

    const nowMs = this.now()
    this.pruneStarts(nowMs)
    if (this.startTimesMs.length >= startsPerHour) {
      const nextAvailableAtMs = this.startTimesMs[0]! + oneHourMs
      this.queue.shift()
      this.rejectEntry(entry, new LocalRateLimitError(nextAvailableAtMs))
      queueMicrotask(() => this.pump())
      return
    }

    const nextStartMs = this.nextStartTime(nowMs)
    if (nextStartMs > nowMs) {
      this.timer = setTimeout(() => {
        this.timer = null
        this.pump()
      }, nextStartMs - nowMs)
      return
    }

    this.queue.shift()
    entry.started = true
    entry.controller = new AbortController()
    this.lastStartMs = nowMs
    this.startTimesMs.push(nowMs)
    void this.run(entry)
    this.timer = setTimeout(() => {
      this.timer = null
      this.pump()
    }, minimumStartSpacingMs)
  }

  private async run(entry: QueueEntry): Promise<void> {
    try {
      const response = await this.fetchImplementation(entry.url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        signal: entry.controller.signal,
      })
      const nowMs = this.now()
      if (response.status === 429) {
        const retryAt = retryAfterTime(response.headers.get('Retry-After'), nowMs)
        if (retryAt !== null) this.blockedUntilMs = Math.max(this.blockedUntilMs, retryAt)
      }
      for (const subscriber of entry.subscribers) {
        if (subscriber.settled) continue
        subscriber.settled = true
        if (subscriber.abortListener !== null && subscriber.signal !== undefined) {
          subscriber.signal.removeEventListener('abort', subscriber.abortListener)
        }
        subscriber.resolve(response.clone())
      }
    } catch (error) {
      this.rejectEntry(entry, error)
    } finally {
      if (this.entriesByUrl.get(entry.url) === entry) this.entriesByUrl.delete(entry.url)
      this.pump()
    }
  }
}

export const weatherRequestScheduler = new RequestScheduler()
