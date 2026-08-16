import IGCParser from 'igc-parser'
import {
  haversineDistanceM,
  type AltitudeReference,
  type Flight,
  type FlightPoint,
  type FlightSegment,
  type ReplayAltitudeSource,
} from '../domain/flight'

const maximumFileBytes = 10 * 1024 * 1024
const maximumFixRecords = 100_000
const maximumRenderPoints = 20_000
const maximumGapMs = 10_000

export type IgcImportErrorCode =
  | 'file-too-large'
  | 'unsupported-file'
  | 'empty-file'
  | 'binary-file'
  | 'too-many-fixes'
  | 'invalid-igc'
  | 'insufficient-track'
  | 'segment-budget'

export class IgcImportError extends Error {
  readonly code: IgcImportErrorCode

  constructor(code: IgcImportErrorCode, message: string) {
    super(message)
    this.name = 'IgcImportError'
    this.code = code
  }
}

export function sanitizeIgcText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const sanitized = value
    .replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 120)
  return sanitized.length === 0 ? null : sanitized
}

function looksLikeIgc(text: string): boolean {
  const lines = text.replace(/^\uFEFF/u, '').split(/\r?\n/u)
  const firstRecord = lines.find((line) => line.trim().length > 0)?.trim() ?? ''
  if (!/^[AHB]/u.test(firstRecord)) return false
  const hasARecord = lines.some((line) => /^A[A-Z0-9]{3}/iu.test(line.trim()))
  const hasDateHeader = lines.some((line) => /^H.DTE(?:DATE:)?\d{6}/iu.test(line.trim()))
  const hasFix = lines.some((line) => /^B\d{6}\d{7}[NS]\d{8}[EW][AV]/u.test(line.trim()))
  return hasARecord && hasDateHeader && hasFix
}

function parserWarning(error: Error, lines: string[]): string {
  const message = error.message
  const lineMatch = /\bat line (\d+)/iu.exec(message)
  const lineNumber = lineMatch === null ? null : Number(lineMatch[1])
  const recordType =
    lineNumber !== null && lineNumber > 0 && lineNumber <= lines.length
      ? lines[lineNumber - 1]?.trim().charAt(0).toUpperCase() || null
      : null
  if (lineNumber !== null && recordType !== null && /^[A-Z]$/u.test(recordType)) {
    return `${recordType} record at line ${lineNumber} was skipped by the IGC parser.`
  }
  if (lineNumber !== null) return `IGC record at line ${lineNumber} was skipped by the parser.`
  if (/missing A record/iu.test(message)) return 'The IGC parser could not find a required A record.'
  if (/missing HFDTE record/iu.test(message)) return 'The IGC parser could not find a required flight date.'
  return 'The IGC parser reported a malformed record.'
}

function altitudeRange(
  segments: FlightSegment[],
  key: 'gpsAltitudeM' | 'pressureAltitudeM',
): readonly [number, number] | null {
  let minimum = Number.POSITIVE_INFINITY
  let maximum = Number.NEGATIVE_INFINITY
  for (const segment of segments) {
    for (const point of segment.points) {
      const altitude = point[key]
      if (altitude === null || !Number.isFinite(altitude)) continue
      minimum = Math.min(minimum, altitude)
      maximum = Math.max(maximum, altitude)
    }
  }
  return Number.isFinite(minimum) && Number.isFinite(maximum) ? [minimum, maximum] : null
}

function splitHorizontalSegments(
  fixes: IGCParser.BRecord[],
  warnings: string[],
): { segments: FlightSegment[]; usableFixCount: number } {
  const rawSegments: FlightSegment[] = []
  let current: FlightPoint[] = []
  let previousTimestamp: number | null = null
  let usableFixCount = 0
  const warningSet = new Set(warnings)
  const warnOnce = (warning: string) => {
    if (warningSet.has(warning)) return
    warningSet.add(warning)
    warnings.push(warning)
  }
  const flush = () => {
    if (current.length > 0) rawSegments.push({ points: current })
    current = []
  }

  for (const fix of fixes) {
    const coordinateIsUsable =
      Number.isFinite(fix.timestamp) &&
      Number.isFinite(fix.latitude) &&
      Number.isFinite(fix.longitude) &&
      fix.latitude >= -90 &&
      fix.latitude <= 90 &&
      fix.longitude >= -180 &&
      fix.longitude <= 180
    if (!fix.valid || !coordinateIsUsable) {
      flush()
      previousTimestamp = null
      warnOnce(
        !fix.valid
          ? 'Invalid V fixes split the replay track.'
          : 'Fixes with unusable timestamps or coordinates were removed and split the track.',
      )
      continue
    }

    const point: FlightPoint = {
      timestampMs: fix.timestamp,
      latitude: fix.latitude,
      longitude: fix.longitude,
      valid: true,
      gpsAltitudeM:
        fix.gpsAltitude !== null && Number.isFinite(fix.gpsAltitude)
          ? fix.gpsAltitude
          : null,
      pressureAltitudeM:
        fix.pressureAltitude !== null && Number.isFinite(fix.pressureAltitude)
          ? fix.pressureAltitude
          : null,
    }
    usableFixCount += 1

    if (previousTimestamp !== null) {
      const gapMs = point.timestampMs - previousTimestamp
      if (gapMs <= 0 || gapMs > maximumGapMs) {
        flush()
        warnOnce(
          gapMs <= 0
            ? 'Non-increasing fix times split the replay track.'
            : 'Fix gaps longer than 10 seconds split the replay track.',
        )
      }
    }
    current.push(point)
    previousTimestamp = point.timestampMs
  }
  flush()

  const segments = rawSegments.filter((segment) => {
    if (segment.points.length >= 2) return true
    warnOnce('One-point track segments were dropped because they cannot form a route.')
    return false
  })
  return { segments, usableFixCount }
}


function selectEvenInterior(points: FlightPoint[], count: number): FlightPoint[] {
  if (count >= points.length - 2) return points
  const interiorCount = points.length - 2
  const selected = new Array<FlightPoint>(count + 2)
  selected[0] = points[0]!
  for (let index = 0; index < count; index += 1) {
    const interiorIndex = Math.floor(((index + 1) * (interiorCount + 1)) / (count + 1))
    selected[index + 1] = points[interiorIndex]!
  }
  selected[selected.length - 1] = points[points.length - 1]!
  return selected
}

export function decimateFlightSegments(
  segments: FlightSegment[],
  warnings: string[],
  budget = maximumRenderPoints,
): FlightSegment[] {
  const totalPoints = segments.reduce((sum, segment) => sum + segment.points.length, 0)
  if (totalPoints <= budget) return segments

  const endpointReserve = segments.length * 2
  if (endpointReserve > budget) {
    throw new IgcImportError(
      'segment-budget',
      'The track contains too many separate segments to render within the safe point budget.',
    )
  }

  const availableInterior = budget - endpointReserve
  const interiorCounts = segments.map((segment) => Math.max(0, segment.points.length - 2))
  const totalInterior = interiorCounts.reduce((sum, count) => sum + count, 0)
  const allocations = interiorCounts.map((count) =>
    Math.floor((availableInterior * count) / totalInterior),
  )
  let slotsLeft = availableInterior - allocations.reduce((sum, count) => sum + count, 0)
  const remainderOrder = interiorCounts
    .map((count, index) => ({
      index,
      remainder: (availableInterior * count) / totalInterior - allocations[index]!,
    }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index)
  for (const allocation of remainderOrder) {
    if (slotsLeft === 0) break
    if (allocations[allocation.index]! < interiorCounts[allocation.index]!) {
      allocations[allocation.index]! += 1
      slotsLeft -= 1
    }
  }

  warnings.push(
    `The rendered route was decimated from ${totalPoints} to ${budget} points; statistics still use the full track.`,
  )
  return segments.map((segment, index) => ({
    points: selectEvenInterior(segment.points, allocations[index]!),
  }))
}

function determineAltitudeSource(
  segments: FlightSegment[],
  geoDatumAlgorithm: string,
  warnings: string[],
): { source: ReplayAltitudeSource; reference: AltitudeReference } {
  let gpsCount = 0
  let pressureCount = 0
  for (const segment of segments) {
    for (const point of segment.points) {
      if (point.gpsAltitudeM !== null) gpsCount += 1
      if (point.pressureAltitudeM !== null) pressureCount += 1
    }
  }

  if (gpsCount >= 2) {
    if (geoDatumAlgorithm.trim().toUpperCase() === 'GEO') {
      warnings.push(
        'GPS/GEO altitude is retained for the data panel; the 2D replay does not compare it with terrain.',
      )
      return { source: 'gps', reference: 'wgs84-geoid' }
    }
    warnings.push(
      'GNSS altitude uses an ellipsoid or undeclared vertical datum; it is retained for data only.',
    )
    return { source: 'gps', reference: 'ellipsoid-or-unknown' }
  }
  if (pressureCount >= 2) {
    warnings.push(
      'GNSS altitude is unavailable; pressure/ISA altitude is retained for data only and is not drawn as map height.',
    )
    return { source: 'pressure', reference: 'isa-pressure' }
  }
  warnings.push('Source altitude is unavailable; replay remains a 2D map track.')
  return { source: 'none', reference: 'ellipsoid-or-unknown' }
}

export async function parseIgcFile(file: File): Promise<Flight> {
  if (file.size > maximumFileBytes) {
    throw new IgcImportError('file-too-large', 'IGC files must not exceed 10 MiB.')
  }

  let text: string
  try {
    text = await file.text()
  } catch {
    throw new IgcImportError('invalid-igc', 'The selected file could not be read in this browser.')
  }
  text = text.replace(/^\uFEFF/u, '')
  if (text.trim().length === 0) {
    throw new IgcImportError('empty-file', 'The selected file is empty.')
  }
  if (text.includes('\0')) {
    throw new IgcImportError('binary-file', 'The selected file contains binary data and is not a text IGC log.')
  }

  const hasIgcExtension = /\.igc$/iu.test(file.name)
  if (!hasIgcExtension && !looksLikeIgc(text)) {
    throw new IgcImportError(
      'unsupported-file',
      'Choose an .igc file or a plain-text file beginning with recognizable IGC records.',
    )
  }

  const lines = text.split(/\r?\n/u)
  let fixRecordCount = 0
  for (const line of lines) {
    if (/^B/u.test(line.trim())) fixRecordCount += 1
    if (fixRecordCount > maximumFixRecords) {
      throw new IgcImportError(
        'too-many-fixes',
        'The IGC contains more than 100,000 fix records and was not parsed.',
      )
    }
  }

  let parsed: IGCParser.IGCFile
  try {
    parsed = IGCParser.parse(text, { lenient: true, parseComments: false })
  } catch (error) {
    const safeMessage = error instanceof Error ? parserWarning(error, lines) : 'The IGC is malformed.'
    throw new IgcImportError('invalid-igc', safeMessage)
  }

  const warnings = parsed.errors.map((error) => parserWarning(error, lines))
  const { segments, usableFixCount } = splitHorizontalSegments(parsed.fixes, warnings)
  if (usableFixCount < 2 || segments.length === 0) {
    throw new IgcImportError(
      'insufficient-track',
      'The IGC needs at least two usable fixes in a continuous track segment.',
    )
  }

  const { reference } = determineAltitudeSource(
    segments,
    parsed.geoDatumAlgorithm ?? '',
    warnings,
  )
  const renderSegments = decimateFlightSegments(segments, warnings)

  let distanceM = 0
  let firstTimestamp = Number.POSITIVE_INFINITY
  let lastTimestamp = Number.NEGATIVE_INFINITY
  let pointCount = 0
  for (const segment of segments) {
    pointCount += segment.points.length
    firstTimestamp = Math.min(firstTimestamp, segment.points[0]!.timestampMs)
    lastTimestamp = Math.max(lastTimestamp, segment.points[segment.points.length - 1]!.timestampMs)
    for (let index = 1; index < segment.points.length; index += 1) {
      distanceM += haversineDistanceM(segment.points[index - 1]!, segment.points[index]!)
    }
  }

  return {
    filename: sanitizeIgcText(file.name) ?? 'flight.igc',
    dateUtc: sanitizeIgcText(parsed.date),
    site: sanitizeIgcText(parsed.site),
    altitudeReference: reference,
    segments,
    renderSegments,
    pointCount,
    durationMs: Math.max(0, lastTimestamp - firstTimestamp),
    distanceM,
    gpsAltitudeRangeM: altitudeRange(segments, 'gpsAltitudeM'),
    pressureAltitudeRangeM: altitudeRange(segments, 'pressureAltitudeM'),
    warnings,
  }
}
