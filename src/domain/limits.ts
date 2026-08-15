import { z } from 'zod'
import type { SiteId } from './sites'

export const windSectors = [
  'N',
  'NNE',
  'NE',
  'ENE',
  'E',
  'ESE',
  'SE',
  'SSE',
  'S',
  'SSW',
  'SW',
  'WSW',
  'W',
  'WNW',
  'NW',
  'NNW',
] as const

export type WindSector = (typeof windSectors)[number]
export type WindUnit = 'kmh' | 'mps' | 'kt'

export interface SiteLimits {
  maxAverageMps: number | null
  maxGustMps: number | null
  allowedFromSectors: WindSector[]
}

export interface PreferencesV1 {
  version: 1
  locale: 'en' | 'de'
  windUnit: WindUnit
  limits: Record<SiteId, SiteLimits>
}

const maximumMps = 200 / 3.6
const optionalLimitSchema = z.number().finite().positive().max(maximumMps).nullable()
const siteLimitsSchema = z
  .object({
    maxAverageMps: optionalLimitSchema,
    maxGustMps: optionalLimitSchema,
    allowedFromSectors: z.array(z.enum(windSectors)).max(windSectors.length),
  })
  .strict()
  .superRefine((limits, context) => {
    if (
      limits.maxAverageMps !== null &&
      limits.maxGustMps !== null &&
      limits.maxGustMps < limits.maxAverageMps
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Maximum gust must be at least maximum average wind.',
        path: ['maxGustMps'],
      })
    }
    if (new Set(limits.allowedFromSectors).size !== limits.allowedFromSectors.length) {
      context.addIssue({
        code: 'custom',
        message: 'Direction sectors must be unique.',
        path: ['allowedFromSectors'],
      })
    }
  })

export const preferencesSchema = z
  .object({
    version: z.literal(1),
    locale: z.enum(['en', 'de']),
    windUnit: z.enum(['kmh', 'mps', 'kt']),
    limits: z
      .object({ schoeckl: siteLimitsSchema, gelderkogel: siteLimitsSchema })
      .strict(),
  })
  .strict()

const emptyLimits = (): SiteLimits => ({
  maxAverageMps: null,
  maxGustMps: null,
  allowedFromSectors: [],
})

function browserLocale(): 'en' | 'de' {
  return typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('de')
    ? 'de'
    : 'en'
}

export function defaultPreferences(locale = browserLocale()): PreferencesV1 {
  return {
    version: 1,
    locale,
    windUnit: 'kmh',
    limits: { schoeckl: emptyLimits(), gelderkogel: emptyLimits() },
  }
}

const storageKey = 'para.preferences.v1'
let memoryPreferences = defaultPreferences()

export function loadPreferences(): PreferencesV1 {
  try {
    const serialized = globalThis.localStorage?.getItem(storageKey)
    if (serialized === null || serialized === undefined) return memoryPreferences
    const parsed = preferencesSchema.safeParse(JSON.parse(serialized))
    if (parsed.success) {
      memoryPreferences = parsed.data
      return parsed.data
    }
  } catch {
    return memoryPreferences
  }
  memoryPreferences = defaultPreferences()
  try {
    globalThis.localStorage?.removeItem(storageKey)
  } catch {
    // In-memory preferences remain usable when storage is denied.
  }
  return memoryPreferences
}

export function savePreferences(value: PreferencesV1): boolean {
  const parsed = preferencesSchema.safeParse(value)
  if (!parsed.success) return false
  memoryPreferences = parsed.data
  try {
    globalThis.localStorage?.setItem(storageKey, JSON.stringify(parsed.data))
    return true
  } catch {
    return false
  }
}

export function resetSiteLimits(preferences: PreferencesV1, siteId: SiteId): PreferencesV1 {
  return {
    ...preferences,
    limits: { ...preferences.limits, [siteId]: emptyLimits() },
  }
}

export function resetAllPreferences(locale = browserLocale()): PreferencesV1 {
  const reset = defaultPreferences(locale)
  savePreferences(reset)
  return reset
}

export function windSectorFromDegrees(degrees: number): WindSector {
  const index = Math.floor((((degrees % 360) + 360 + 11.25) % 360) / 22.5)
  return windSectors[index]!
}

export const germanWindSector: Record<WindSector, string> = {
  N: 'N',
  NNE: 'NNO',
  NE: 'NO',
  ENE: 'ONO',
  E: 'O',
  ESE: 'OSO',
  SE: 'SO',
  SSE: 'SSO',
  S: 'S',
  SSW: 'SSW',
  SW: 'SW',
  WSW: 'WSW',
  W: 'W',
  WNW: 'WNW',
  NW: 'NW',
  NNW: 'NNW',
}

export type LimitComparisonStatus =
  | 'at-or-under-entered-limit'
  | 'over-entered-limit'
  | 'inside-selected-sector'
  | 'outside-selected-sector'
  | 'not-evaluated'

export interface WindComparisonData {
  averageMps: number | null
  gustMps: number | null
  fromDegrees: number | null
}

export interface LimitComparison {
  metric: 'average' | 'gust' | 'direction'
  status: LimitComparisonStatus
  value: number | WindSector | null
  limit: number | WindSector[] | null
}

export type ComparisonFreshness = 'fresh' | 'stale' | 'missing'

export function compareWindToLimits(
  data: WindComparisonData,
  limits: SiteLimits,
  freshness: ComparisonFreshness,
): LimitComparison[] {
  const unavailable = freshness !== 'fresh'
  const compareNumeric = (
    metric: 'average' | 'gust',
    value: number | null,
    limit: number | null,
  ): LimitComparison => ({
    metric,
    value,
    limit,
    status:
      unavailable || value === null || !Number.isFinite(value) || limit === null
        ? 'not-evaluated'
        : value <= limit + 1e-6
          ? 'at-or-under-entered-limit'
          : 'over-entered-limit',
  })

  const sector =
    data.fromDegrees !== null && Number.isFinite(data.fromDegrees)
      ? windSectorFromDegrees(data.fromDegrees)
      : null
  const direction: LimitComparison = {
    metric: 'direction',
    value: sector,
    limit: limits.allowedFromSectors,
    status:
      unavailable ||
      data.averageMps === null ||
      data.averageMps < 0.5 ||
      sector === null ||
      limits.allowedFromSectors.length === 0
        ? 'not-evaluated'
        : limits.allowedFromSectors.includes(sector)
          ? 'inside-selected-sector'
          : 'outside-selected-sector',
  }

  return [
    compareNumeric('average', data.averageMps, limits.maxAverageMps),
    compareNumeric('gust', data.gustMps, limits.maxGustMps),
    direction,
  ]
}

export function windFromMps(value: number, unit: WindUnit): number {
  if (unit === 'kmh') return value * 3.6
  if (unit === 'kt') return value * 1.9438444924406
  return value
}

export function windToMps(value: number, unit: WindUnit): number {
  if (unit === 'kmh') return value / 3.6
  if (unit === 'kt') return value / 1.9438444924406
  return value
}
