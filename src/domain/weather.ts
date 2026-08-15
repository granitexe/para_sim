import type { SiteId } from './sites'

export interface Coordinate {
  latitude: number
  longitude: number
}

export interface StationMeta {
  id: string
  name: string
  state: string | null
  active: boolean
  coordinate: Coordinate
  elevationM: number | null
  distanceToSitesM: Record<SiteId, number>
  fetchedAtMs: number
  sourceUrl: string
}

export interface StationObservation {
  stationId: string
  observationTimeMs: number
  fetchedAtMs: number
  windFromDeg: number | null
  gustWindFromDeg: number | null
  meanWindMps: number | null
  gustMps: number | null
  temperatureC: number | null
  dewPointC: number | null
  relativeHumidityPercent: number | null
  stationPressureHpa: number | null
  precipitation10MinMm: number | null
  sourceUrl: string
  dataWarnings: string[]
}

export interface StationHistoryPoint {
  stationId: string
  validTimeMs: number
  fetchedAtMs: number
  windFromDeg: number | null
  gustWindFromDeg: number | null
  meanWindMps: number | null
  gustMps: number | null
  temperatureC: number | null
  dewPointC: number | null
  relativeHumidityPercent: number | null
  stationPressureHpa: number | null
  precipitation10MinMm: number | null
  sourceUrl: string
  dataWarnings: string[]
}

export interface ModelPointMeta {
  siteId: SiteId
  requestedCoordinate: Coordinate
  gridCoordinate: Coordinate
  gridDistanceM: number
  stationOrModelElevationM: number | null
  modelName: string
  modelResolution: string
  referenceTimeMs: number | null
  fetchedAtMs: number
  sourceUrl: string
}

export interface SiteNowcastPoint extends ModelPointMeta {
  validTimeMs: number
  windFromDeg: number | null
  meanWindMps: number | null
  gustMps: number | null
  temperatureC: number | null
  dewPointC: number | null
  relativeHumidityPercent: number | null
  precipitationMm: number | null
  dataWarnings: string[]
}

export interface SiteForecastPoint extends ModelPointMeta {
  validTimeMs: number
  windFromDeg: number | null
  meanWindMps: number | null
  gustMps: number | null
  precipitationMm: number | null
  cloudCoverPercent: number | null
  temperatureC: number | null
  relativeHumidityPercent: number | null
  surfacePressureHpa: number | null
  snowLineM: number | null
  capeJkg: number | null
  cinJkg: number | null
  globalRadiationWm2: number | null
  dataWarnings: string[]
}

export interface AloftWindPoint {
  siteId: SiteId
  requestedCoordinate: Coordinate
  gridCoordinate: Coordinate
  gridDistanceM: number
  stationOrModelElevationM: number | null
  modelName: 'DWD ICON-D2 via Open-Meteo'
  modelResolution: 'approximately 2 km'
  referenceTimeMs: null
  validTimeMs: number
  fetchedAtMs: number
  sourceUrl: string
  pressureLevelHpa: 850 | 800 | 700
  geopotentialHeightM: number | null
  windFromDeg: number | null
  windSpeedMps: number | null
  gustMps: null
  dataWarnings: string[]
}

export interface OfficialWarning {
  siteId: SiteId
  requestedCoordinate: Coordinate
  municipalityNumber: string | null
  officialLevel: string | null
  type: string | null
  text: string
  effects: string | null
  recommendations: string | null
  startTimeMs: number | null
  endTimeMs: number | null
  providerBeginText: string | null
  providerEndText: string | null
  machineReadableIntervalAvailable: boolean
  fetchedAtMs: number
  sourceUrl: string
}

export interface AutomatedThunderstormStatus {
  siteId: SiteId
  municipalityNumber: string | null
  active: boolean
  rawIntensity: string | number | null
  fetchedAtMs: number
  sourceUrl: string
}

export type ResourceUnavailableReason =
  | 'local-rate-limit'
  | 'http-429'
  | 'schema-mismatch'
  | 'cors'
  | 'offline'
  | 'fetch-failure'
  | 'aborted'
  | 'missing-data'

export type LoadState<T> =
  | { status: 'idle' }
  | { status: 'loading'; startedAtMs: number; previous: T | null }
  | {
      status: 'available'
      data: T
      fetchedAtMs: number
      stale: boolean
      dataWarnings: string[]
    }
  | {
      status: 'unavailable'
      reason: ResourceUnavailableReason
      checkedAtMs: number
      nextAllowedAtMs: number | null
      message: string
    }

export type ComparisonDataKind = 'observation' | 'nowcast' | 'nwp'

const freshnessLimitMs: Record<ComparisonDataKind, number> = {
  observation: 20 * 60 * 1000,
  nowcast: 45 * 60 * 1000,
  nwp: 6 * 60 * 60 * 1000,
}

export function comparisonFreshness(
  kind: ComparisonDataKind,
  sourceTimestampMs: number | null,
  nowMs: number,
): 'fresh' | 'stale' | 'missing' {
  if (sourceTimestampMs === null || !Number.isFinite(sourceTimestampMs)) return 'missing'
  return nowMs - sourceTimestampMs <= freshnessLimitMs[kind] ? 'fresh' : 'stale'
}

export function vectorWindFromUv(
  uMps: number | null,
  vMps: number | null,
): { speedMps: number | null; fromDegrees: number | null } {
  if (uMps === null || vMps === null || !Number.isFinite(uMps) || !Number.isFinite(vMps)) {
    return { speedMps: null, fromDegrees: null }
  }
  const speedMps = Math.hypot(uMps, vMps)
  if (speedMps < 0.05) return { speedMps, fromDegrees: null }
  const fromDegrees = ((Math.atan2(-uMps, -vMps) * 180) / Math.PI + 360) % 360
  return { speedMps, fromDegrees }
}

export function directionForScalarWind(
  speedMps: number | null,
  fromDegrees: number | null,
): number | null {
  if (
    speedMps === null ||
    !Number.isFinite(speedMps) ||
    speedMps < 0.05 ||
    fromDegrees === null ||
    !Number.isFinite(fromDegrees) ||
    fromDegrees < 0 ||
    fromDegrees > 360
  ) {
    return null
  }
  return fromDegrees === 360 ? 0 : fromDegrees
}

export function haversineCoordinateDistanceM(a: Coordinate, b: Coordinate): number {
  const radians = Math.PI / 180
  const latitude1 = a.latitude * radians
  const latitude2 = b.latitude * radians
  const latitudeDelta = (b.latitude - a.latitude) * radians
  const longitudeDelta = (b.longitude - a.longitude) * radians
  const sinLatitude = Math.sin(latitudeDelta / 2)
  const sinLongitude = Math.sin(longitudeDelta / 2)
  const value =
    sinLatitude * sinLatitude +
    Math.cos(latitude1) * Math.cos(latitude2) * sinLongitude * sinLongitude
  return 2 * 6_371_008.8 * Math.asin(Math.min(1, Math.sqrt(value)))
}

export function destinationCoordinate(
  start: Coordinate,
  bearingDegrees: number,
  distanceM: number,
): Coordinate {
  const radiusM = 6_371_008.8
  const angularDistance = distanceM / radiusM
  const bearing = (bearingDegrees * Math.PI) / 180
  const latitude1 = (start.latitude * Math.PI) / 180
  const longitude1 = (start.longitude * Math.PI) / 180
  const latitude2 = Math.asin(
    Math.sin(latitude1) * Math.cos(angularDistance) +
      Math.cos(latitude1) * Math.sin(angularDistance) * Math.cos(bearing),
  )
  const longitude2 =
    longitude1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitude1),
      Math.cos(angularDistance) - Math.sin(latitude1) * Math.sin(latitude2),
    )
  return {
    latitude: (latitude2 * 180) / Math.PI,
    longitude: ((((longitude2 * 180) / Math.PI + 540) % 360) + 360) % 360 - 180,
  }
}
