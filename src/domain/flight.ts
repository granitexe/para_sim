export type AltitudeReference = 'wgs84-geoid' | 'ellipsoid-or-unknown' | 'isa-pressure'

export interface FlightPoint {
  timestampMs: number
  latitude: number
  longitude: number
  valid: boolean
  gpsAltitudeM: number | null
  pressureAltitudeM: number | null
}

export interface FlightSegment {
  points: FlightPoint[]
}

export interface Flight {
  filename: string
  dateUtc: string | null
  site: string | null
  altitudeReference: AltitudeReference
  segments: FlightSegment[]
  renderSegments: FlightSegment[]
  pointCount: number
  durationMs: number
  distanceM: number
  gpsAltitudeRangeM: readonly [number, number] | null
  pressureAltitudeRangeM: readonly [number, number] | null
  warnings: string[]
}

export type ReplayAltitudeSource = 'gps' | 'pressure' | 'none'

export function replayAltitudeSource(flight: Flight): ReplayAltitudeSource {
  const gpsCount = flight.segments.reduce(
    (count, segment) => count + segment.points.filter((point) => point.gpsAltitudeM !== null).length,
    0,
  )
  if (gpsCount >= 2) return 'gps'

  const pressureCount = flight.segments.reduce(
    (count, segment) => count + segment.points.filter((point) => point.pressureAltitudeM !== null).length,
    0,
  )
  return pressureCount >= 2 ? 'pressure' : 'none'
}

export function selectedAltitudeM(
  point: FlightPoint,
  source: ReplayAltitudeSource,
): number | null {
  if (source === 'gps') return point.gpsAltitudeM
  if (source === 'pressure') return point.pressureAltitudeM
  return null
}

const earthRadiusM = 6_371_008.8

export function haversineDistanceM(a: FlightPoint, b: FlightPoint): number {
  const toRadians = Math.PI / 180
  const latitude1 = a.latitude * toRadians
  const latitude2 = b.latitude * toRadians
  const latitudeDelta = (b.latitude - a.latitude) * toRadians
  const longitudeDelta = (b.longitude - a.longitude) * toRadians
  const sinLatitude = Math.sin(latitudeDelta / 2)
  const sinLongitude = Math.sin(longitudeDelta / 2)
  const haversine =
    sinLatitude * sinLatitude +
    Math.cos(latitude1) * Math.cos(latitude2) * sinLongitude * sinLongitude
  return 2 * earthRadiusM * Math.asin(Math.min(1, Math.sqrt(haversine)))
}

export interface FlightDerivedMetrics {
  point: FlightPoint
  groundSpeedMps: number | null
  varioMps: number | null
}

export function deriveFlightMetrics(
  flight: Flight,
  timestampMs: number,
): FlightDerivedMetrics | null {
  let selectedSegment: FlightSegment | null = null
  let selectedIndex = -1
  let smallestDelta = Number.POSITIVE_INFINITY

  for (const segment of flight.segments) {
    for (let index = 0; index < segment.points.length; index += 1) {
      const delta = Math.abs(segment.points[index]!.timestampMs - timestampMs)
      if (delta < smallestDelta) {
        smallestDelta = delta
        selectedSegment = segment
        selectedIndex = index
      }
    }
  }
  if (selectedSegment === null || selectedIndex < 0) return null

  const points = selectedSegment.points
  const centerTimestamp = points[selectedIndex]!.timestampMs
  const startTarget = centerTimestamp - 2_500
  const endTarget = centerTimestamp + 2_500
  let startIndex = selectedIndex
  let endIndex = selectedIndex
  while (startIndex > 0 && points[startIndex - 1]!.timestampMs >= startTarget) startIndex -= 1
  while (
    endIndex < points.length - 1 &&
    points[endIndex + 1]!.timestampMs <= endTarget
  ) {
    endIndex += 1
  }

  const elapsedSeconds =
    (points[endIndex]!.timestampMs - points[startIndex]!.timestampMs) / 1_000
  if (elapsedSeconds <= 0) {
    return { point: points[selectedIndex]!, groundSpeedMps: null, varioMps: null }
  }

  let distanceM = 0
  for (let index = startIndex + 1; index <= endIndex; index += 1) {
    distanceM += haversineDistanceM(points[index - 1]!, points[index]!)
  }

  const start = points[startIndex]!
  const end = points[endIndex]!
  let altitudeDeltaM: number | null = null
  if (start.pressureAltitudeM !== null && end.pressureAltitudeM !== null) {
    altitudeDeltaM = end.pressureAltitudeM - start.pressureAltitudeM
  } else if (start.gpsAltitudeM !== null && end.gpsAltitudeM !== null) {
    altitudeDeltaM = end.gpsAltitudeM - start.gpsAltitudeM
  }

  return {
    point: points[selectedIndex]!,
    groundSpeedMps: distanceM / elapsedSeconds,
    varioMps: altitudeDeltaM === null ? null : altitudeDeltaM / elapsedSeconds,
  }
}
