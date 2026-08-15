import { z } from 'zod'
import { sites, siteIds, type SiteId } from '../domain/sites'
import {
  directionForScalarWind,
  haversineCoordinateDistanceM,
  type AloftWindPoint,
} from '../domain/weather'
import { weatherRequestScheduler, type RequestScheduler } from './requestScheduler'
import {
  finiteOrNull,
  MemorySuccessCache,
  normalizeDirection,
  normalizeNonnegative,
  requestScheduledJson,
  WeatherClientError,
} from './weatherClientUtils'

export const OPEN_METEO_ICON_ENDPOINT = 'https://api.open-meteo.com/v1/dwd-icon'
const pressureLevels = [850, 800, 700] as const
const threeHoursMs = 3 * 60 * 60 * 1_000
const nullableNumbers = z.array(z.number().nullable())
const hourlySchema = z
  .object({
    time: z.array(z.string()),
    wind_speed_850hPa: nullableNumbers,
    wind_direction_850hPa: nullableNumbers,
    geopotential_height_850hPa: nullableNumbers,
    wind_speed_800hPa: nullableNumbers,
    wind_direction_800hPa: nullableNumbers,
    geopotential_height_800hPa: nullableNumbers,
    wind_speed_700hPa: nullableNumbers,
    wind_direction_700hPa: nullableNumbers,
    geopotential_height_700hPa: nullableNumbers,
  })
  .passthrough()
const locationSchema = z
  .object({
    latitude: z.number(),
    longitude: z.number(),
    elevation: z.number().nullable().optional(),
    timezone: z.string(),
    hourly: hourlySchema,
  })
  .passthrough()
const responseSchema = z.union([locationSchema, z.array(locationSchema)])

export type OpenMeteoLocation = z.infer<typeof locationSchema>
export type OpenMeteoResponse = z.infer<typeof responseSchema>

function utcTimestamp(value: string): number {
  const timestamp = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/u.test(value) ? value : `${value}Z`)
  if (!Number.isFinite(timestamp)) {
    throw new WeatherClientError('schema-mismatch', 'An ICON-D2 valid time was invalid.')
  }
  return timestamp
}

function alignedArray(
  values: Array<number | null>,
  length: number,
  name: string,
  warnings: string[],
): Array<number | null> {
  if (values.length === length) return values
  warnings.push(`${name} did not align with ICON-D2 timestamps.`)
  return Array.from({ length }, () => null)
}

function nearestLocation(locations: OpenMeteoLocation[], siteId: SiteId): OpenMeteoLocation | null {
  const requested = { latitude: sites[siteId].latitude, longitude: sites[siteId].longitude }
  let nearest: OpenMeteoLocation | null = null
  let distanceM = Number.POSITIVE_INFINITY
  for (const location of locations) {
    const candidate = { latitude: location.latitude, longitude: location.longitude }
    const candidateDistance = haversineCoordinateDistanceM(requested, candidate)
    if (candidateDistance < distanceM) {
      nearest = location
      distanceM = candidateDistance
    }
  }
  return nearest
}

export function transformOpenMeteoAloft(
  response: OpenMeteoResponse,
  fetchedAtMs: number,
  sourceUrl: string,
): Record<SiteId, AloftWindPoint[]> {
  const locations = Array.isArray(response) ? response : [response]
  const result: Record<SiteId, AloftWindPoint[]> = { schoeckl: [], gelderkogel: [] }
  for (const siteId of siteIds) {
    const location = nearestLocation(locations, siteId)
    if (location === null) continue
    const warnings: string[] = []
    const length = location.hourly.time.length
    const requestedCoordinate = {
      latitude: sites[siteId].latitude,
      longitude: sites[siteId].longitude,
    }
    const gridCoordinate = { latitude: location.latitude, longitude: location.longitude }
    for (const pressureLevelHpa of pressureLevels) {
      const speedName = `wind_speed_${pressureLevelHpa}hPa` as const
      const directionName = `wind_direction_${pressureLevelHpa}hPa` as const
      const heightName = `geopotential_height_${pressureLevelHpa}hPa` as const
      const speeds = alignedArray(location.hourly[speedName], length, speedName, warnings)
      const directions = alignedArray(
        location.hourly[directionName],
        length,
        directionName,
        warnings,
      )
      const heights = alignedArray(location.hourly[heightName], length, heightName, warnings)
      for (let index = 0; index < length; index += 1) {
        const pointWarnings = [...new Set(warnings)]
        const windSpeedMps = normalizeNonnegative(
          speeds[index],
          pointWarnings,
          speedName,
        )
        const windFromDeg = directionForScalarWind(
          windSpeedMps,
          normalizeDirection(directions[index], pointWarnings, directionName),
        )
        result[siteId].push({
          siteId,
          requestedCoordinate,
          gridCoordinate,
          gridDistanceM: haversineCoordinateDistanceM(requestedCoordinate, gridCoordinate),
          stationOrModelElevationM: finiteOrNull(location.elevation),
          modelName: 'DWD ICON-D2 via Open-Meteo',
          modelResolution: 'approximately 2 km',
          referenceTimeMs: null,
          validTimeMs: utcTimestamp(location.hourly.time[index]!),
          fetchedAtMs,
          sourceUrl,
          pressureLevelHpa,
          geopotentialHeightM: finiteOrNull(heights[index]),
          windFromDeg,
          windSpeedMps,
          gustMps: null,
          dataWarnings: [...new Set(pointWarnings)],
        })
      }
    }
  }
  return result
}

export function aloftRowsAboveSite(
  points: AloftWindPoint[],
  siteElevationM: number,
): AloftWindPoint[] {
  return points.filter(
    (point) =>
      point.geopotentialHeightM !== null &&
      point.geopotentialHeightM >= siteElevationM + 100,
  )
}

function aloftUrl(): URL {
  const url = new URL(OPEN_METEO_ICON_ENDPOINT)
  url.searchParams.set('latitude', siteIds.map((siteId) => sites[siteId].latitude).join(','))
  url.searchParams.set('longitude', siteIds.map((siteId) => sites[siteId].longitude).join(','))
  url.searchParams.set('elevation', siteIds.map((siteId) => sites[siteId].elevationM).join(','))
  url.searchParams.set('models', 'icon_d2')
  url.searchParams.set('timezone', 'GMT')
  url.searchParams.set('wind_speed_unit', 'ms')
  url.searchParams.set('forecast_hours', '49')
  url.searchParams.set(
    'hourly',
    pressureLevels
      .flatMap((level) => [
        `wind_speed_${level}hPa`,
        `wind_direction_${level}hPa`,
        `geopotential_height_${level}hPa`,
      ])
      .join(','),
  )
  return url
}

export class OpenMeteoClient {
  private readonly scheduler: RequestScheduler
  private readonly cache = new MemorySuccessCache<Record<SiteId, AloftWindPoint[]>>()

  constructor(scheduler: RequestScheduler = weatherRequestScheduler) {
    this.scheduler = scheduler
  }

  async getAloft(signal?: AbortSignal): Promise<Record<SiteId, AloftWindPoint[]>> {
    const cached = this.cache.get('both-sites')
    if (cached !== null) return cached
    const { data, fetchedAtMs, sourceUrl } = await requestScheduledJson(
      this.scheduler,
      aloftUrl(),
      responseSchema,
      signal,
    )
    const transformed = transformOpenMeteoAloft(data, fetchedAtMs, sourceUrl)
    this.cache.set('both-sites', transformed, threeHoursMs)
    return transformed
  }

  invalidate(): void {
    this.cache.clear()
  }
}

export const openMeteoClient = new OpenMeteoClient()
