import { z } from 'zod'
import { sites, siteIds, type SiteId } from '../domain/sites'
import {
  directionForScalarWind,
  haversineCoordinateDistanceM,
  vectorWindFromUv,
  type AutomatedThunderstormStatus,
  type LoadState,
  type OfficialWarning,
  type RegionalWindField,
  type SiteForecastPoint,
  type SiteNowcastPoint,
  type StationHistoryPoint,
  type StationMeta,
  type StationObservation,
} from '../domain/weather'
import { weatherRequestScheduler, type RequestScheduler } from './requestScheduler'
import {
  finiteOrNull,
  MemorySuccessCache,
  normalizeDirection,
  normalizeHumidity,
  normalizeNonnegative,
  requestScheduledJson,
  WeatherClientError,
} from './weatherClientUtils'

export const GEOSPHERE_ENDPOINTS = {
  stationMetadata:
    'https://dataset.api.hub.geosphere.at/v1/station/current/tawes-v1-10min/metadata',
  stationCurrent:
    'https://dataset.api.hub.geosphere.at/v1/station/current/tawes-v1-10min',
  stationHistory:
    'https://dataset.api.hub.geosphere.at/v1/station/historical/tawes-v1-10min',
  nowcast:
    'https://dataset.api.hub.geosphere.at/v1/timeseries/forecast/nowcast-v1-15min-1km',
  nwp: 'https://dataset.api.hub.geosphere.at/v1/timeseries/forecast/nwp-v1-1h-2500m',
  windField:
    'https://dataset.api.hub.geosphere.at/v1/grid/forecast/nwp-v1-1h-2500m',
  warnings: 'https://warnungen.zamg.at/wsapp/api/getWarningsForCoords',
  thunderstorm: 'https://warnungen.zamg.at/wsapp/api/getGewitterAuto',
} as const

const observationParameters = ['DD', 'DDX', 'FFAM', 'FFX', 'TL', 'TP', 'RF', 'P', 'RR'] as const
const nowcastParameters = ['dd', 'ff', 'fx', 'rh2m', 'rr', 't2m', 'td'] as const
const nwpParameters = [
  'cape',
  'cin',
  'grad',
  'rh2m',
  'rr_acc',
  'snowlmt',
  'sp',
  't2m',
  'tcc',
  'u10m',
  'ugust',
  'v10m',
  'vgust',
] as const
const windFieldParameters = ['u10m', 'v10m'] as const
export const windFieldBounds = {
  south: 47.1,
  west: 15.35,
  north: 47.4,
  east: 15.65,
} as const

const stationSchema = z
  .object({
    id: z.union([z.string(), z.number()]),
    name: z.string(),
    state: z.string().nullable().optional(),
    lat: z.number(),
    lon: z.number(),
    altitude: z.number().nullable().optional(),
    valid_from: z.string().nullable().optional(),
    valid_to: z.string().nullable().optional(),
  })
  .passthrough()
const metadataSchema = z
  .object({ time: z.string(), stations: z.array(stationSchema) })
  .passthrough()
const parameterSchema = z
  .object({ data: z.array(z.number().nullable()) })
  .passthrough()
const featureSchema = z
  .object({
    geometry: z.object({
      type: z.string(),
      coordinates: z.tuple([z.number(), z.number()]),
    }),
    properties: z
      .object({
        parameters: z.record(z.string(), parameterSchema),
        station: z.union([z.string(), z.number()]).optional(),
      })
      .passthrough(),
  })
  .passthrough()
const timeseriesSchema = z
  .object({
    timestamps: z.array(z.string()),
    reference_time: z.string().nullable().optional(),
    features: z.array(featureSchema),
  })
  .passthrough()

const rawWarningSchema = z
  .object({
    properties: z
      .object({
        location: z
          .object({
            properties: z
              .object({ gemeindenr: z.union([z.string(), z.number()]).nullable().optional() })
              .passthrough(),
          })
          .passthrough(),
        warnings: z.array(
          z
            .object({
              properties: z
                .object({
                  warntypid: z.union([z.string(), z.number()]).nullable().optional(),
                  begin: z.string().nullable().optional(),
                  end: z.string().nullable().optional(),
                  text: z.string().nullable().optional(),
                  auswirkungen: z.string().nullable().optional(),
                  empfehlungen: z.string().nullable().optional(),
                  warnstufeid: z.union([z.string(), z.number()]).nullable().optional(),
                  rawinfo: z
                    .object({
                      wtype: z.union([z.string(), z.number()]).nullable().optional(),
                      wlevel: z.union([z.string(), z.number()]).nullable().optional(),
                      start: z.union([z.string(), z.number()]).nullable().optional(),
                      end: z.union([z.string(), z.number()]).nullable().optional(),
                    })
                    .passthrough()
                    .nullable()
                    .optional(),
                })
                .passthrough(),
            })
            .passthrough(),
        ),
      })
      .passthrough(),
  })
  .passthrough()
const thunderstormSchema = z
  .object({
    features: z.array(
      z
        .object({ properties: z.record(z.string(), z.unknown()).optional() })
        .passthrough(),
    ),
  })
  .passthrough()

export type MetadataResponse = z.infer<typeof metadataSchema>
export type TimeseriesResponse = z.infer<typeof timeseriesSchema>
type TimeseriesFeature = z.infer<typeof featureSchema>
export type RawWarningResponse = z.infer<typeof rawWarningSchema>
export type ThunderstormResponse = z.infer<typeof thunderstormSchema>

const tenMinutesMs = 10 * 60 * 1_000
const oneHourMs = 60 * 60 * 1_000

function parsedTimestamp(value: string): number {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) {
    throw new WeatherClientError('schema-mismatch', 'A provider timestamp was invalid.')
  }
  return timestamp
}

function parameterData(
  feature: TimeseriesFeature,
  name: string,
  expectedLength: number,
  warnings: string[],
): Array<number | null> {
  const data = feature.properties.parameters[name]?.data
  if (data === undefined || data.length !== expectedLength) {
    warnings.push(`${name} did not align with provider timestamps.`)
    return Array.from({ length: expectedLength }, () => null)
  }
  return data
}

function uniqueWarnings(warnings: string[]): string[] {
  return [...new Set(warnings)]
}

function observationDirection(
  speedMps: number | null,
  fromDegrees: number | null,
): number | null {
  return speedMps !== null && speedMps < 0.05 ? null : fromDegrees
}

export function transformStationMetadata(
  response: MetadataResponse,
  fetchedAtMs: number,
  sourceUrl: string,
  nowMs = fetchedAtMs,
): StationMeta[] {
  return response.stations
    .map((station): StationMeta | null => {
      const coordinate = { latitude: station.lat, longitude: station.lon }
      if (
        !Number.isFinite(coordinate.latitude) ||
        !Number.isFinite(coordinate.longitude) ||
        station.state !== 'Steiermark'
      ) {
        return null
      }
      const validFrom = station.valid_from === null || station.valid_from === undefined
        ? Number.NEGATIVE_INFINITY
        : Date.parse(station.valid_from)
      const validTo = station.valid_to === null || station.valid_to === undefined
        ? Number.POSITIVE_INFINITY
        : Date.parse(station.valid_to)
      const active = Number.isFinite(validFrom) && Number.isFinite(validTo) && validFrom <= nowMs && validTo >= nowMs
      if (!active) return null

      const distanceToSitesM = {
        schoeckl: haversineCoordinateDistanceM(coordinate, {
          latitude: sites.schoeckl.latitude,
          longitude: sites.schoeckl.longitude,
        }),
        gelderkogel: haversineCoordinateDistanceM(coordinate, {
          latitude: sites.gelderkogel.latitude,
          longitude: sites.gelderkogel.longitude,
        }),
      }
      if (Math.min(distanceToSitesM.schoeckl, distanceToSitesM.gelderkogel) > 45_000) return null
      return {
        id: String(station.id),
        name: station.name,
        state: station.state ?? null,
        active,
        coordinate,
        elevationM: finiteOrNull(station.altitude),
        distanceToSitesM,
        fetchedAtMs,
        sourceUrl,
      }
    })
    .filter((station): station is StationMeta => station !== null)
}

export function transformStationObservations(
  response: TimeseriesResponse,
  stationCatalog: StationMeta[],
  fetchedAtMs: number,
  sourceUrl: string,
): StationObservation[] {
  if (response.timestamps.length === 0) return []
  const observationTimeMs = parsedTimestamp(response.timestamps[response.timestamps.length - 1]!)
  const knownStations = new Set(stationCatalog.map((station) => station.id))
  const observations: StationObservation[] = []
  for (const feature of response.features) {
    const stationId = feature.properties.station === undefined ? '' : String(feature.properties.station)
    if (!knownStations.has(stationId)) continue
    const warnings: string[] = []
    const index = response.timestamps.length - 1
    const value = (name: string) => parameterData(feature, name, response.timestamps.length, warnings)[index]
    const meanWindMps = normalizeNonnegative(value('FFAM'), warnings, 'FFAM')
    const gustMps = normalizeNonnegative(value('FFX'), warnings, 'FFX')
    const windFromDeg = observationDirection(
      meanWindMps,
      normalizeDirection(value('DD'), warnings, 'DD'),
    )
    const gustWindFromDeg = observationDirection(
      gustMps,
      normalizeDirection(value('DDX'), warnings, 'DDX'),
    )
    if (windFromDeg === null && meanWindMps === null && gustMps === null) continue
    observations.push({
      stationId,
      observationTimeMs,
      fetchedAtMs,
      windFromDeg,
      gustWindFromDeg,
      meanWindMps,
      gustMps,
      temperatureC: finiteOrNull(value('TL')),
      dewPointC: finiteOrNull(value('TP')),
      relativeHumidityPercent: normalizeHumidity(value('RF'), warnings, 'RF'),
      stationPressureHpa: finiteOrNull(value('P')),
      precipitation10MinMm: normalizeNonnegative(value('RR'), warnings, 'RR'),
      sourceUrl,
      dataWarnings: uniqueWarnings(warnings),
    })
  }
  return observations
}

export function transformStationHistory(
  response: TimeseriesResponse,
  stationId: string,
  fetchedAtMs: number,
  sourceUrl: string,
): StationHistoryPoint[] {
  const feature = response.features.find(
    (candidate) => String(candidate.properties.station ?? '') === stationId,
  )
  if (feature === undefined) return []
  const warnings: string[] = []
  const arrays = Object.fromEntries(
    observationParameters.map((name) => [
      name,
      parameterData(feature, name, response.timestamps.length, warnings),
    ]),
  ) as Record<(typeof observationParameters)[number], Array<number | null>>

  return response.timestamps.map((timestamp, index) => {
    const rowWarnings = [...warnings]
    const meanWindMps = normalizeNonnegative(arrays.FFAM[index], rowWarnings, 'FFAM')
    const gustMps = normalizeNonnegative(arrays.FFX[index], rowWarnings, 'FFX')
    return {
      stationId,
      validTimeMs: parsedTimestamp(timestamp),
      fetchedAtMs,
      windFromDeg: observationDirection(
        meanWindMps,
        normalizeDirection(arrays.DD[index], rowWarnings, 'DD'),
      ),
      gustWindFromDeg: observationDirection(
        gustMps,
        normalizeDirection(arrays.DDX[index], rowWarnings, 'DDX'),
      ),
      meanWindMps,
      gustMps,
      temperatureC: finiteOrNull(arrays.TL[index]),
      dewPointC: finiteOrNull(arrays.TP[index]),
      relativeHumidityPercent: normalizeHumidity(arrays.RF[index], rowWarnings, 'RF'),
      stationPressureHpa: finiteOrNull(arrays.P[index]),
      precipitation10MinMm: normalizeNonnegative(arrays.RR[index], rowWarnings, 'RR'),
      sourceUrl,
      dataWarnings: uniqueWarnings(rowWarnings),
    }
  })
}

function closestFeature(response: TimeseriesResponse, siteId: SiteId): TimeseriesFeature | null {
  const site = sites[siteId]
  const requested = { latitude: site.latitude, longitude: site.longitude }
  let closest: TimeseriesFeature | null = null
  let distance = Number.POSITIVE_INFINITY
  for (const feature of response.features) {
    const coordinate = {
      latitude: feature.geometry.coordinates[1],
      longitude: feature.geometry.coordinates[0],
    }
    const candidateDistance = haversineCoordinateDistanceM(requested, coordinate)
    if (candidateDistance < distance) {
      closest = feature
      distance = candidateDistance
    }
  }
  return closest
}

export function transformNowcast(
  response: TimeseriesResponse,
  fetchedAtMs: number,
  sourceUrl: string,
): Record<SiteId, SiteNowcastPoint[]> {
  if (response.reference_time === null || response.reference_time === undefined) {
    throw new WeatherClientError('schema-mismatch', 'The nowcast reference time was missing.')
  }
  const referenceTimeMs = parsedTimestamp(response.reference_time)
  const result: Record<SiteId, SiteNowcastPoint[]> = { schoeckl: [], gelderkogel: [] }
  for (const siteId of siteIds) {
    const feature = closestFeature(response, siteId)
    if (feature === null) continue
    const warnings: string[] = []
    const arrays = Object.fromEntries(
      nowcastParameters.map((name) => [
        name,
        parameterData(feature, name, response.timestamps.length, warnings),
      ]),
    ) as Record<(typeof nowcastParameters)[number], Array<number | null>>
    const requestedCoordinate = {
      latitude: sites[siteId].latitude,
      longitude: sites[siteId].longitude,
    }
    const gridCoordinate = {
      latitude: feature.geometry.coordinates[1],
      longitude: feature.geometry.coordinates[0],
    }
    result[siteId] = response.timestamps.map((timestamp, index) => {
      const pointWarnings = [...warnings]
      const meanWindMps = normalizeNonnegative(arrays.ff[index], pointWarnings, 'ff')
      return {
        siteId,
        requestedCoordinate,
        gridCoordinate,
        gridDistanceM: haversineCoordinateDistanceM(requestedCoordinate, gridCoordinate),
        stationOrModelElevationM: null,
        modelName: 'GeoSphere nowcast-v1-15min-1km',
        modelResolution: '1 km / 15 minutes',
        referenceTimeMs,
        fetchedAtMs,
        sourceUrl,
        validTimeMs: parsedTimestamp(timestamp),
        windFromDeg: directionForScalarWind(
          meanWindMps,
          normalizeDirection(arrays.dd[index], pointWarnings, 'dd'),
        ),
        meanWindMps,
        gustMps: normalizeNonnegative(arrays.fx[index], pointWarnings, 'fx'),
        temperatureC: finiteOrNull(arrays.t2m[index]),
        dewPointC: finiteOrNull(arrays.td[index]),
        relativeHumidityPercent: normalizeHumidity(arrays.rh2m[index], pointWarnings, 'rh2m'),
        precipitationMm: normalizeNonnegative(arrays.rr[index], pointWarnings, 'rr'),
        dataWarnings: uniqueWarnings(pointWarnings),
      }
    })
  }
  return result
}

function accumulatedIntervals(
  values: Array<number | null>,
  label: string,
  divisor: number,
  warnings: string[],
): Array<number | null> {
  const intervals = Array.from({ length: values.length }, () => null as number | null)
  for (let index = 1; index < values.length; index += 1) {
    const previous = finiteOrNull(values[index - 1])
    const current = finiteOrNull(values[index])
    if (previous === null || current === null) continue
    if (previous < 0 || current < 0) {
      warnings.push(`${label} contained a negative accumulation; the affected interval is unavailable.`)
      continue
    }
    const delta = current - previous
    if (delta < 0) {
      warnings.push(`${label} accumulation reset; the affected interval is unavailable.`)
      continue
    }
    intervals[index] = delta / divisor
  }
  return intervals
}

export function transformNwp(
  response: TimeseriesResponse,
  fetchedAtMs: number,
  sourceUrl: string,
): Record<SiteId, SiteForecastPoint[]> {
  if (response.reference_time === null || response.reference_time === undefined) {
    throw new WeatherClientError('schema-mismatch', 'The NWP reference time was missing.')
  }
  const referenceTimeMs = parsedTimestamp(response.reference_time)
  const result: Record<SiteId, SiteForecastPoint[]> = { schoeckl: [], gelderkogel: [] }
  for (const siteId of siteIds) {
    const feature = closestFeature(response, siteId)
    if (feature === null) continue
    const warnings: string[] = []
    const arrays = Object.fromEntries(
      nwpParameters.map((name) => [
        name,
        parameterData(feature, name, response.timestamps.length, warnings),
      ]),
    ) as Record<(typeof nwpParameters)[number], Array<number | null>>
    const precipitation = accumulatedIntervals(arrays.rr_acc, 'rr_acc', 1, warnings)
    const radiation = accumulatedIntervals(arrays.grad, 'grad', 3600, warnings)
    const requestedCoordinate = {
      latitude: sites[siteId].latitude,
      longitude: sites[siteId].longitude,
    }
    const gridCoordinate = {
      latitude: feature.geometry.coordinates[1],
      longitude: feature.geometry.coordinates[0],
    }
    result[siteId] = response.timestamps.map((timestamp, index) => {
      const pointWarnings = [...warnings]
      const mean = vectorWindFromUv(
        finiteOrNull(arrays.u10m[index]),
        finiteOrNull(arrays.v10m[index]),
      )
      const gust = vectorWindFromUv(
        finiteOrNull(arrays.ugust[index]),
        finiteOrNull(arrays.vgust[index]),
      )
      const cloudFraction = finiteOrNull(arrays.tcc[index])
      let cloudCoverPercent: number | null = null
      if (cloudFraction !== null && cloudFraction >= 0 && cloudFraction <= 1) {
        cloudCoverPercent = cloudFraction * 100
      } else if (cloudFraction !== null) {
        pointWarnings.push('tcc contained a value outside 0…1.')
      }
      const surfacePressurePa = finiteOrNull(arrays.sp[index])
      return {
        siteId,
        requestedCoordinate,
        gridCoordinate,
        gridDistanceM: haversineCoordinateDistanceM(requestedCoordinate, gridCoordinate),
        stationOrModelElevationM: null,
        modelName: 'GeoSphere nwp-v1-1h-2500m',
        modelResolution: '2.5 km / 1 hour',
        referenceTimeMs,
        fetchedAtMs,
        sourceUrl,
        validTimeMs: parsedTimestamp(timestamp),
        windFromDeg: mean.fromDegrees,
        meanWindMps: mean.speedMps,
        gustMps: gust.speedMps,
        precipitationMm: normalizeNonnegative(precipitation[index], pointWarnings, 'rr_acc interval'),
        cloudCoverPercent,
        temperatureC: finiteOrNull(arrays.t2m[index]),
        relativeHumidityPercent: normalizeHumidity(arrays.rh2m[index], pointWarnings, 'rh2m'),
        surfacePressureHpa: surfacePressurePa === null ? null : surfacePressurePa / 100,
        snowLineM: normalizeNonnegative(arrays.snowlmt[index], pointWarnings, 'snowlmt'),
        capeJkg: normalizeNonnegative(arrays.cape[index], pointWarnings, 'cape'),
        cinJkg: finiteOrNull(arrays.cin[index]),
        globalRadiationWm2: normalizeNonnegative(radiation[index], pointWarnings, 'grad interval'),
        dataWarnings: uniqueWarnings(pointWarnings),
      }
    })
  }
  return result
}

export function transformRegionalWindField(
  response: TimeseriesResponse,
  fetchedAtMs: number,
  sourceUrl: string,
): RegionalWindField {
  if (response.reference_time === null || response.reference_time === undefined) {
    throw new WeatherClientError('schema-mismatch', 'The regional wind-field reference time was missing.')
  }
  if (response.timestamps.length !== 1) {
    throw new WeatherClientError('schema-mismatch', 'The regional wind field requires exactly one valid time.')
  }
  const validTimeMs = parsedTimestamp(response.timestamps[0]!)
  const points = response.features.map((feature) => {
    const warnings: string[] = []
    const eastward = parameterData(feature, 'u10m', 1, warnings)[0]
    const northward = parameterData(feature, 'v10m', 1, warnings)[0]
    const wind = vectorWindFromUv(finiteOrNull(eastward), finiteOrNull(northward))
    return {
      gridCoordinate: {
        latitude: feature.geometry.coordinates[1],
        longitude: feature.geometry.coordinates[0],
      },
      validTimeMs,
      windFromDeg: wind.fromDegrees,
      windSpeedMps: wind.speedMps,
      dataWarnings: uniqueWarnings(warnings),
    }
  })
  return {
    points,
    bounds: windFieldBounds,
    modelName: 'GeoSphere nwp-v1-1h-2500m',
    modelResolution: '2.5 km / 1 hour',
    referenceTimeMs: parsedTimestamp(response.reference_time),
    validTimeMs,
    fetchedAtMs,
    sourceUrl,
  }
}

function epochSeconds(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || String(value).trim().length === 0) return null
  const seconds = Number(value)
  const milliseconds = seconds * 1_000
  return Number.isFinite(milliseconds) ? milliseconds : null
}

export interface OfficialWarningResult {
  warnings: OfficialWarning[]
  municipalityNumber: string | null
  fetchedAtMs: number
}

export function transformWarnings(
  response: RawWarningResponse,
  siteId: SiteId,
  fetchedAtMs: number,
  sourceUrl: string,
): OfficialWarningResult {
  const municipalityValue = response.properties.location.properties.gemeindenr
  const municipalityNumber =
    municipalityValue === null || municipalityValue === undefined
      ? null
      : String(municipalityValue)
  const requestedCoordinate = {
    latitude: sites[siteId].latitude,
    longitude: sites[siteId].longitude,
  }
  const warnings = response.properties.warnings.map((warning): OfficialWarning => {
    const properties = warning.properties
    const startTimeMs = epochSeconds(properties.rawinfo?.start)
    const endTimeMs = epochSeconds(properties.rawinfo?.end)
    return {
      siteId,
      requestedCoordinate,
      municipalityNumber,
      officialLevel:
        properties.warnstufeid === null || properties.warnstufeid === undefined
          ? properties.rawinfo?.wlevel === null || properties.rawinfo?.wlevel === undefined
            ? null
            : String(properties.rawinfo.wlevel)
          : String(properties.warnstufeid),
      type:
        properties.warntypid === null || properties.warntypid === undefined
          ? properties.rawinfo?.wtype === null || properties.rawinfo?.wtype === undefined
            ? null
            : String(properties.rawinfo.wtype)
          : String(properties.warntypid),
      text: properties.text ?? '',
      effects: properties.auswirkungen ?? null,
      recommendations: properties.empfehlungen ?? null,
      startTimeMs,
      endTimeMs,
      providerBeginText: properties.begin ?? null,
      providerEndText: properties.end ?? null,
      machineReadableIntervalAvailable: startTimeMs !== null && endTimeMs !== null,
      fetchedAtMs,
      sourceUrl,
    }
  })
  return { warnings, municipalityNumber, fetchedAtMs }
}

export function transformThunderstormStatus(
  response: ThunderstormResponse,
  siteId: SiteId,
  municipalityNumber: string | null,
  fetchedAtMs: number,
  sourceUrl: string,
): AutomatedThunderstormStatus {
  const match = response.features.find((feature) => {
    const properties = feature.properties ?? {}
    const value = properties.gemeindenr ?? properties.gemeinde
    return municipalityNumber !== null && value !== null && value !== undefined && String(value) === municipalityNumber
  })
  const matchProperties = match?.properties ?? {}
  const rawIntensity = matchProperties.intensitaet ?? matchProperties.intensity ?? null
  return {
    siteId,
    municipalityNumber,
    active: match !== undefined,
    rawIntensity:
      typeof rawIntensity === 'string' || typeof rawIntensity === 'number' ? rawIntensity : null,
    fetchedAtMs,
    sourceUrl,
  }
}

export interface StationCurrentResult {
  stations: StationMeta[]
  observations: StationObservation[]
  fetchedAtMs: number
}

export interface WarningResources {
  official: LoadState<OfficialWarningResult>
  thunderstorm: LoadState<AutomatedThunderstormStatus>
}

interface ThunderstormRawResult {
  data: ThunderstormResponse
  fetchedAtMs: number
  sourceUrl: string
}

function unavailableState<T>(error: unknown): LoadState<T> {
  const normalized =
    error instanceof WeatherClientError
      ? error
      : new WeatherClientError('fetch-failure', 'The provider request failed.')
  return {
    status: 'unavailable',
    reason: normalized.reason,
    checkedAtMs: normalized.checkedAtMs,
    nextAllowedAtMs: normalized.nextAllowedAtMs,
    message: normalized.message,
  }
}

export class GeoSphereClient {
  private readonly scheduler: RequestScheduler
  private metadataPromise: Promise<StationMeta[]> | null = null
  private readonly currentCache = new MemorySuccessCache<StationCurrentResult>()
  private readonly historyCache = new MemorySuccessCache<StationHistoryPoint[]>()
  private readonly nowcastCache = new MemorySuccessCache<Record<SiteId, SiteNowcastPoint[]>>()
  private readonly nwpCache = new MemorySuccessCache<Record<SiteId, SiteForecastPoint[]>>()
  private readonly windFieldCache = new MemorySuccessCache<RegionalWindField>()
  private readonly officialWarningCache = new MemorySuccessCache<OfficialWarningResult>()
  private readonly thunderstormCache = new MemorySuccessCache<ThunderstormRawResult>()

  constructor(scheduler: RequestScheduler = weatherRequestScheduler) {
    this.scheduler = scheduler
  }

  getStationCatalog(): Promise<StationMeta[]> {
    if (this.metadataPromise !== null) return this.metadataPromise
    const request = requestScheduledJson(
      this.scheduler,
      GEOSPHERE_ENDPOINTS.stationMetadata,
      metadataSchema,
    ).then(({ data, fetchedAtMs, sourceUrl }) =>
      transformStationMetadata(data, fetchedAtMs, sourceUrl),
    )
    const cachedPromise = request.catch((error: unknown) => {
      if (this.metadataPromise === cachedPromise) this.metadataPromise = null
      throw error
    })
    this.metadataPromise = cachedPromise
    return cachedPromise
  }

  async getCurrent(signal?: AbortSignal): Promise<StationCurrentResult> {
    const cached = this.currentCache.get('current')
    if (cached !== null) return cached
    const stations = await this.getStationCatalog()
    const url = new URL(GEOSPHERE_ENDPOINTS.stationCurrent)
    url.searchParams.set('parameters', observationParameters.join(','))
    url.searchParams.set('station_ids', stations.map((station) => station.id).join(','))
    const { data, fetchedAtMs, sourceUrl } = await requestScheduledJson(
      this.scheduler,
      url,
      timeseriesSchema,
      signal,
    )
    const result = {
      stations,
      observations: transformStationObservations(data, stations, fetchedAtMs, sourceUrl),
      fetchedAtMs,
    }
    this.currentCache.set('current', result, tenMinutesMs)
    return result
  }

  async getHistory(
    stationId: string,
    nowMs = Date.now(),
    signal?: AbortSignal,
  ): Promise<StationHistoryPoint[]> {
    const cached = this.historyCache.get(stationId, nowMs)
    if (cached !== null) return cached
    const url = new URL(GEOSPHERE_ENDPOINTS.stationHistory)
    url.searchParams.set('parameters', observationParameters.join(','))
    url.searchParams.set('station_ids', stationId)
    url.searchParams.set('start', new Date(nowMs - 24 * oneHourMs).toISOString())
    url.searchParams.set('end', new Date(nowMs).toISOString())
    const { data, fetchedAtMs, sourceUrl } = await requestScheduledJson(
      this.scheduler,
      url,
      timeseriesSchema,
      signal,
    )
    const history = transformStationHistory(data, stationId, fetchedAtMs, sourceUrl)
    this.historyCache.set(stationId, history, tenMinutesMs, nowMs)
    return history
  }

  private twoSiteUrl(endpoint: string, parameters: readonly string[]): URL {
    const url = new URL(endpoint)
    url.searchParams.set('parameters', parameters.join(','))
    for (const siteId of siteIds) {
      url.searchParams.append('lat_lon', `${sites[siteId].latitude},${sites[siteId].longitude}`)
    }
    return url
  }

  async getNowcast(signal?: AbortSignal): Promise<Record<SiteId, SiteNowcastPoint[]>> {
    const cached = this.nowcastCache.get('both-sites')
    if (cached !== null) return cached
    const { data, fetchedAtMs, sourceUrl } = await requestScheduledJson(
      this.scheduler,
      this.twoSiteUrl(GEOSPHERE_ENDPOINTS.nowcast, nowcastParameters),
      timeseriesSchema,
      signal,
    )
    const transformed = transformNowcast(data, fetchedAtMs, sourceUrl)
    this.nowcastCache.set('both-sites', transformed, tenMinutesMs)
    return transformed
  }

  async getNwp(signal?: AbortSignal): Promise<Record<SiteId, SiteForecastPoint[]>> {
    const cached = this.nwpCache.get('both-sites')
    if (cached !== null) return cached
    const { data, fetchedAtMs, sourceUrl } = await requestScheduledJson(
      this.scheduler,
      this.twoSiteUrl(GEOSPHERE_ENDPOINTS.nwp, nwpParameters),
      timeseriesSchema,
      signal,
    )
    const transformed = transformNwp(data, fetchedAtMs, sourceUrl)
    this.nwpCache.set('both-sites', transformed, oneHourMs)
    return transformed
  }

  async getWindField(
    nowMs = Date.now(),
    signal?: AbortSignal,
  ): Promise<RegionalWindField> {
    const validTimeMs = Math.floor(nowMs / oneHourMs) * oneHourMs
    const key = String(validTimeMs)
    const cached = this.windFieldCache.get(key, nowMs)
    if (cached !== null) return cached
    const url = new URL(GEOSPHERE_ENDPOINTS.windField)
    for (const parameter of windFieldParameters) url.searchParams.append('parameters', parameter)
    url.searchParams.set(
      'bbox',
      `${windFieldBounds.south},${windFieldBounds.west},${windFieldBounds.north},${windFieldBounds.east}`,
    )
    const validTime = new Date(validTimeMs).toISOString()
    url.searchParams.set('start', validTime)
    url.searchParams.set('end', validTime)
    const { data, fetchedAtMs, sourceUrl } = await requestScheduledJson(
      this.scheduler,
      url,
      timeseriesSchema,
      signal,
    )
    const transformed = transformRegionalWindField(data, fetchedAtMs, sourceUrl)
    this.windFieldCache.set(key, transformed, oneHourMs, nowMs)
    return transformed
  }

  private async getOfficialWarnings(
    siteId: SiteId,
    locale: 'en' | 'de',
    signal?: AbortSignal,
  ): Promise<OfficialWarningResult> {
    const key = `${siteId}:${locale}`
    const cached = this.officialWarningCache.get(key)
    if (cached !== null) return cached
    const url = new URL(GEOSPHERE_ENDPOINTS.warnings)
    url.searchParams.set('lat', String(sites[siteId].latitude))
    url.searchParams.set('lon', String(sites[siteId].longitude))
    url.searchParams.set('lang', locale)
    const { data, fetchedAtMs, sourceUrl } = await requestScheduledJson(
      this.scheduler,
      url,
      rawWarningSchema,
      signal,
    )
    const transformed = transformWarnings(data, siteId, fetchedAtMs, sourceUrl)
    this.officialWarningCache.set(key, transformed, tenMinutesMs)
    return transformed
  }

  private async getThunderstormRaw(signal?: AbortSignal): Promise<ThunderstormRawResult> {
    const cached = this.thunderstormCache.get('auto')
    if (cached !== null) return cached
    const result = await requestScheduledJson(
      this.scheduler,
      GEOSPHERE_ENDPOINTS.thunderstorm,
      thunderstormSchema,
      signal,
    )
    this.thunderstormCache.set('auto', result, tenMinutesMs)
    return result
  }

  async getWarningResources(
    siteId: SiteId,
    locale: 'en' | 'de',
    signal?: AbortSignal,
  ): Promise<WarningResources> {
    const [officialResult, thunderResult] = await Promise.allSettled([
      this.getOfficialWarnings(siteId, locale, signal),
      this.getThunderstormRaw(signal),
    ])
    const official: LoadState<OfficialWarningResult> =
      officialResult.status === 'fulfilled'
        ? {
            status: 'available',
            data: officialResult.value,
            fetchedAtMs: officialResult.value.fetchedAtMs,
            stale: false,
            dataWarnings: [],
          }
        : unavailableState(officialResult.reason)

    let thunderstorm: LoadState<AutomatedThunderstormStatus>
    if (thunderResult.status === 'rejected') {
      thunderstorm = unavailableState(thunderResult.reason)
    } else if (officialResult.status === 'rejected') {
      thunderstorm = {
        status: 'unavailable',
        reason: 'missing-data',
        checkedAtMs: thunderResult.value.fetchedAtMs,
        nextAllowedAtMs: null,
        message: 'Municipality matching is unavailable because the coordinate warning lookup failed.',
      }
    } else {
      const status = transformThunderstormStatus(
        thunderResult.value.data,
        siteId,
        officialResult.value.municipalityNumber,
        thunderResult.value.fetchedAtMs,
        thunderResult.value.sourceUrl,
      )
      thunderstorm = {
        status: 'available',
        data: status,
        fetchedAtMs: status.fetchedAtMs,
        stale: false,
        dataWarnings: [],
      }
    }
    return { official, thunderstorm }
  }

  invalidateCurrent(): void {
    this.currentCache.clear()
  }

  invalidateHistory(stationId: string): void {
    this.historyCache.delete(stationId)
  }

  invalidateNowcast(): void {
    this.nowcastCache.clear()
  }

  invalidateNwp(): void {
    this.nwpCache.clear()
  }

  invalidateWindField(): void {
    this.windFieldCache.clear()
  }

  invalidateWarnings(siteId: SiteId, locale: 'en' | 'de'): void {
    this.officialWarningCache.delete(`${siteId}:${locale}`)
    this.thunderstormCache.clear()
  }
}

export const geosphereClient = new GeoSphereClient()
