import { describe, expect, it } from 'vitest'
import { deriveFlightMetrics, replayAltitudeSource, type FlightPoint } from '../src/domain/flight'
import {
  decimateFlightSegments,
  IgcImportError,
  parseIgcFile,
  sanitizeIgcText,
} from '../src/lib/igcAdapter'

interface FixOptions {
  time: string
  latitude?: string
  longitude?: string
  valid?: boolean
  pressure?: number | null
  gps?: number | null
  extension?: string
}

function altitudeField(value: number | null | undefined): string {
  if (value === null || value === undefined) return '00000'
  return value < 0 ? `-${String(Math.abs(value)).padStart(4, '0')}` : String(value).padStart(5, '0')
}

function fix({
  time,
  latitude = '4700000N',
  longitude = '01500000E',
  valid = true,
  pressure = 900,
  gps = 1000,
  extension = '',
}: FixOptions): string {
  return `B${time}${latitude}${longitude}${valid ? 'A' : 'V'}${altitudeField(pressure)}${altitudeField(gps)}${extension}`
}

function syntheticLog(records: string[], headers: string[] = []): string {
  return ['AXCT000', 'HFDTE010126', 'HOALG:GEO', ...headers, ...records].join('\n')
}

function file(text: string, name = 'synthetic.igc', type = ''): File {
  return new File([text], name, { type })
}

describe('parseIgcFile', () => {
  it('keeps only the minimal model and maps source-O GEO altitude', async () => {
    const flight = await parseIgcFile(
      file(
        syntheticLog(
          [
            fix({ time: '120000', gps: 1000, pressure: 900 }),
            fix({ time: '120001', latitude: '4700006N', gps: 1005, pressure: 903 }),
          ],
          ['HOSIT: Test\u0007 launch ', 'HOPLT:Private Pilot', 'LXXXsecret comment', 'GPRIVATE'],
        ),
        ' unsafe\u0001name.IGC',
      ),
    )

    expect(flight).toMatchObject({
      filename: 'unsafe name.IGC',
      site: 'Test launch',
      dateUtc: '2026-01-01',
      altitudeReference: 'wgs84-geoid',
      pointCount: 2,
      durationMs: 1000,
      gpsAltitudeRangeM: [1000, 1005],
      pressureAltitudeRangeM: [900, 903],
    })
    expect(flight.distanceM).toBeGreaterThan(10)
    expect(flight.warnings.join(' ')).toContain('residual terrain offset')
    expect(replayAltitudeSource(flight)).toBe('gps')
    expect(Object.keys(flight)).not.toEqual(
      expect.arrayContaining(['pilot', 'loggerId', 'security', 'raw', 'comments']),
    )
    expect(JSON.stringify(flight)).not.toContain('Private Pilot')
    expect(JSON.stringify(flight)).not.toContain('secret comment')
  })

  it('honors LAD and LOD precision extensions', async () => {
    const flight = await parseIgcFile(
      file(
        syntheticLog([
          'I023636LAD3737LOD',
          fix({ time: '120000', extension: '12' }),
          fix({ time: '120001', extension: '34' }),
        ]),
      ),
    )

    expect(flight.segments[0]!.points[0]!.latitude).toBeCloseTo(47.0000016667, 7)
    expect(flight.segments[0]!.points[0]!.longitude).toBeCloseTo(15.0000033333, 7)
    expect(flight.segments[0]!.points[1]!.latitude).toBeCloseTo(47.000005, 7)
    expect(flight.segments[0]!.points[1]!.longitude).toBeCloseTo(15.0000066667, 7)
  })

  it('preserves midnight rollover', async () => {
    const flight = await parseIgcFile(
      file(syntheticLog([fix({ time: '235959' }), fix({ time: '000001' })])),
    )
    expect(flight.durationMs).toBe(2000)
    expect(flight.segments).toHaveLength(1)
  })

  it('splits at invalid fixes, long gaps, and non-increasing timestamps', async () => {
    const flight = await parseIgcFile(
      file(
        syntheticLog([
          fix({ time: '120000' }),
          fix({ time: '120001' }),
          fix({ time: '120002', valid: false }),
          fix({ time: '120003' }),
          fix({ time: '120004' }),
          fix({ time: '120020' }),
          fix({ time: '120021' }),
          fix({ time: '120021' }),
          fix({ time: '120022' }),
        ]),
      ),
    )
    expect(flight.segments.map((segment) => segment.points.length)).toEqual([2, 2, 2, 2])
    expect(flight.warnings.join(' ')).toContain('Invalid V')
    expect(flight.warnings.join(' ')).toContain('longer than 10 seconds')
    expect(flight.warnings.join(' ')).toContain('Non-increasing')
  })

  it('uses pressure altitude consistently when GNSS altitude is unavailable', async () => {
    const flight = await parseIgcFile(
      file(
        syntheticLog([
          fix({ time: '120000', gps: null, pressure: 800 }),
          fix({ time: '120001', gps: null, pressure: 805 }),
          fix({ time: '120002', gps: null, pressure: null }),
          fix({ time: '120003', gps: null, pressure: 810 }),
          fix({ time: '120004', gps: null, pressure: 815 }),
        ]),
      ),
    )
    expect(flight.altitudeReference).toBe('isa-pressure')
    expect(replayAltitudeSource(flight)).toBe('pressure')
    expect(flight.renderSegments.map((segment) => segment.points.length)).toEqual([2, 2])
    expect(flight.warnings.join(' ')).toContain('pressure/ISA')
  })

  it('loads a time replay as 2D when both altitude sources are unavailable', async () => {
    const flight = await parseIgcFile(
      file(
        syntheticLog([
          fix({ time: '120000', gps: null, pressure: null }),
          fix({ time: '120001', gps: null, pressure: null }),
        ]),
      ),
    )
    expect(replayAltitudeSource(flight)).toBe('none')
    expect(flight.renderSegments).toBe(flight.segments)
    expect(flight.warnings.join(' ')).toContain('2D terrain-draped')
  })

  it('keeps usable fixes when a malformed record becomes a sanitized warning', async () => {
    const rawPayload = 'BPRIVATE-RECORD-PAYLOAD'
    const flight = await parseIgcFile(
      file(
        syntheticLog([
          fix({ time: '120000' }),
          rawPayload,
          fix({ time: '120001' }),
        ]),
      ),
    )
    expect(flight.pointCount).toBe(2)
    expect(flight.warnings).toContain('B record at line 5 was skipped by the IGC parser.')
    expect(JSON.stringify(flight)).not.toContain(rawPayload)
  })

  it('accepts recognized plain text without an extension and rejects unrelated content', async () => {
    const recognized = await parseIgcFile(
      file(
        syntheticLog([fix({ time: '120000' }), fix({ time: '120001' })]),
        'mobile-upload',
        'text/plain',
      ),
    )
    expect(recognized.pointCount).toBe(2)
    await expect(parseIgcFile(file('not an igc', 'notes.txt', 'text/plain'))).rejects.toMatchObject({
      code: 'unsupported-file',
    })
  })

  it('rejects empty, binary, oversized, and insufficient logs before retaining content', async () => {
    await expect(parseIgcFile(file('  '))).rejects.toMatchObject({ code: 'empty-file' })
    await expect(parseIgcFile(file(`${syntheticLog([])}\0binary`))).rejects.toMatchObject({
      code: 'binary-file',
    })
    await expect(
      parseIgcFile(new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.igc')),
    ).rejects.toMatchObject({ code: 'file-too-large' })
    await expect(
      parseIgcFile(file(syntheticLog([fix({ time: '120000' })]))),
    ).rejects.toMatchObject({ code: 'insufficient-track' })
  })

  it('rejects more than 100,000 B records before dependency parsing', async () => {
    const repeated = `${fix({ time: '120000' })}\n`.repeat(100_001)
    await expect(parseIgcFile(file(`AXCT000\nHFDTE010126\n${repeated}`))).rejects.toMatchObject({
      code: 'too-many-fixes',
    })
  })
})

describe('render decimation and derived metrics', () => {
  const point = (timestampMs: number, latitude: number, altitude: number): FlightPoint => ({
    timestampMs,
    latitude,
    longitude: 15,
    valid: true,
    gpsAltitudeM: altitude + 100,
    pressureAltitudeM: altitude,
  })

  it('allocates deterministically and retains every segment endpoint', () => {
    const segments = [
      { points: Array.from({ length: 9 }, (_, index) => point(index * 1000, 47 + index / 1000, index)) },
      { points: Array.from({ length: 5 }, (_, index) => point(index * 1000, 48 + index / 1000, index)) },
    ]
    const warnings: string[] = []
    const decimated = decimateFlightSegments(segments, warnings, 8)
    const repeated = decimateFlightSegments(segments, [], 8)
    expect(decimated).toEqual(repeated)
    expect(decimated.reduce((sum, segment) => sum + segment.points.length, 0)).toBe(8)
    expect(decimated[0]!.points.at(0)).toBe(segments[0]!.points.at(0))
    expect(decimated[0]!.points.at(-1)).toBe(segments[0]!.points.at(-1))
    expect(decimated[1]!.points.at(0)).toBe(segments[1]!.points.at(0))
    expect(decimated[1]!.points.at(-1)).toBe(segments[1]!.points.at(-1))
    expect(warnings[0]).toContain('statistics still use the full track')
  })

  it('rejects an endpoint reserve above the budget', () => {
    const segments = Array.from({ length: 5 }, (_, index) => ({
      points: [point(index * 2000, 47, 0), point(index * 2000 + 1000, 47.001, 1)],
    }))
    expect(() => decimateFlightSegments(segments, [], 8)).toThrow(IgcImportError)
  })

  it('derives centered-window speed and pressure vario without crossing a gap', () => {
    const firstSegment = {
      points: Array.from({ length: 6 }, (_, index) => point(index * 1000, 47 + index / 10_000, index * 2)),
    }
    const secondSegment = { points: [point(20_000, 48, 100), point(21_000, 48.001, 200)] }
    const flight = {
      filename: 'synthetic.igc',
      dateUtc: '2026-01-01',
      site: null,
      altitudeReference: 'wgs84-geoid' as const,
      segments: [firstSegment, secondSegment],
      renderSegments: [firstSegment, secondSegment],
      pointCount: 8,
      durationMs: 21_000,
      distanceM: 0,
      gpsAltitudeRangeM: [100, 300] as const,
      pressureAltitudeRangeM: [0, 200] as const,
      warnings: [],
    }
    const metrics = deriveFlightMetrics(flight, 2_500)
    expect(metrics?.groundSpeedMps).toBeGreaterThan(10)
    expect(metrics?.varioMps).toBeCloseTo(2)
    const edge = deriveFlightMetrics(flight, 5_000)
    expect(edge?.varioMps).toBeCloseTo(2)
    expect(edge?.point.timestampMs).toBe(5_000)
  })
})

describe('sanitization', () => {
  it('removes controls and caps text at 120 characters', () => {
    expect(sanitizeIgcText(`a\u0000b\n${'x'.repeat(200)}`)).toBe(`a b ${'x'.repeat(116)}`)
    expect(sanitizeIgcText(' \n\t ')).toBeNull()
  })
})
