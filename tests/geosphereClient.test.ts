import { describe, expect, it } from 'vitest'
import type { StationMeta } from '../src/domain/weather'
import {
  transformNwp,
  transformNowcast,
  transformStationHistory,
  transformStationObservations,
  transformThunderstormStatus,
  transformWarnings,
  type RawWarningResponse,
  type ThunderstormResponse,
  type TimeseriesResponse,
} from '../src/services/geosphereClient'

function feature(
  longitude: number,
  latitude: number,
  parameters: Record<string, Array<number | null>>,
  station?: string,
): TimeseriesResponse['features'][number] {
  return {
    geometry: { type: 'Point', coordinates: [longitude, latitude] },
    properties: {
      parameters: Object.fromEntries(
        Object.entries(parameters).map(([name, data]) => [name, { data }]),
      ),
      ...(station === undefined ? {} : { station }),
    },
  }
}

const station: StationMeta = {
  id: '11241',
  name: 'SCHOECKL',
  state: 'Steiermark',
  active: true,
  coordinate: { latitude: 47.1986111111, longitude: 15.4663888889 },
  elevationM: 1443,
  distanceToSitesM: { schoeckl: 0, gelderkogel: 12_500 },
  fetchedAtMs: Date.UTC(2026, 0, 1),
  sourceUrl: 'https://example.test/metadata',
}

const fetchedAtMs = Date.UTC(2026, 0, 1, 12, 5)

describe('station transforms', () => {
  it('keeps zero, null fields, source metadata, and the exact direct-station values', () => {
    const response: TimeseriesResponse = {
      timestamps: ['2026-01-01T12:00:00Z'],
      features: [
        feature(
          15.466,
          47.198,
          {
            DD: [180],
            DDX: [200],
            FFAM: [4],
            FFX: [8],
            TL: [10],
            TP: [null],
            RF: [50],
            P: [850],
            RR: [0],
          },
          '11241',
        ),
      ],
    }
    const observations = transformStationObservations(
      response,
      [station],
      fetchedAtMs,
      'https://example.test/current',
    )
    expect(observations).toEqual([
      expect.objectContaining({
        stationId: '11241',
        windFromDeg: 180,
        meanWindMps: 4,
        gustMps: 8,
        dewPointC: null,
        precipitation10MinMm: 0,
        fetchedAtMs,
      }),
    ])
    expect(observations[0]!.meanWindMps! * 3.6).toBeCloseTo(14.4)
    expect(observations[0]!.gustMps! * 3.6).toBeCloseTo(28.8)
  })

  it('retains null history as chart gaps and suppresses calm direction', () => {
    const response: TimeseriesResponse = {
      timestamps: ['2026-01-01T11:50:00Z', '2026-01-01T12:00:00Z'],
      features: [
        feature(
          15.466,
          47.198,
          {
            DD: [180, 270],
            DDX: [null, null],
            FFAM: [null, 0],
            FFX: [8, 0],
            TL: [10, 11],
            TP: [4, 5],
            RF: [50, 51],
            P: [850, 851],
            RR: [0, null],
          },
          '11241',
        ),
      ],
    }
    const history = transformStationHistory(
      response,
      '11241',
      fetchedAtMs,
      'https://example.test/history',
    )
    expect(history[0]).toMatchObject({ meanWindMps: null, gustMps: 8, precipitation10MinMm: 0 })
    expect(history[1]).toMatchObject({ meanWindMps: 0, windFromDeg: null, gustMps: 0 })
  })
})

describe('surface-model transforms', () => {
  it('matches each site to its nearest nowcast grid and preserves zero speed without direction', () => {
    const response: TimeseriesResponse = {
      reference_time: '2026-01-01T11:45:00Z',
      timestamps: ['2026-01-01T12:00:00Z'],
      features: [
        feature(15.479, 47.311, {
          dd: [90], ff: [0], fx: [0], rh2m: [40], rr: [0], t2m: [20], td: [5],
        }),
        feature(15.466, 47.199, {
          dd: [180], ff: [4], fx: [8], rh2m: [50], rr: [0], t2m: [10], td: [4],
        }),
      ],
    }
    const transformed = transformNowcast(response, fetchedAtMs, 'https://example.test/nowcast')
    expect(transformed.schoeckl[0]).toMatchObject({
      gridCoordinate: { latitude: 47.199, longitude: 15.466 },
      windFromDeg: 180,
      meanWindMps: 4,
    })
    expect(transformed.gelderkogel[0]).toMatchObject({
      gridCoordinate: { latitude: 47.311, longitude: 15.479 },
      windFromDeg: null,
      meanWindMps: 0,
      gustMps: 0,
    })
  })

  it('converts vectors, pressure, cloud, rain, and radiation without hiding resets', () => {
    const parameters = {
      u10m: [3, 3, 3],
      v10m: [4, 4, 4],
      ugust: [0, 0, 0],
      vgust: [0, 0, 0],
      rr_acc: [0, 2, 1],
      grad: [0, 3600, 1800],
      sp: [100000, 100100, 100200],
      tcc: [0.5, 0.25, 0],
      rh2m: [50, 51, 52],
      t2m: [10, 11, 12],
      snowlmt: [2000, 2100, 2200],
      cape: [100, 101, 102],
      cin: [-5, -4, -3],
    }
    const response: TimeseriesResponse = {
      reference_time: '2026-01-01T06:00:00Z',
      timestamps: [
        '2026-01-01T12:00:00Z',
        '2026-01-01T13:00:00Z',
        '2026-01-01T14:00:00Z',
      ],
      features: [feature(15.47, 47.2, parameters)],
    }
    const transformed = transformNwp(response, fetchedAtMs, 'https://example.test/nwp').schoeckl
    expect(transformed[0]).toMatchObject({
      meanWindMps: 5,
      windFromDeg: expect.closeTo(216.86989765, 7),
      gustMps: 0,
      precipitationMm: null,
      globalRadiationWm2: null,
      surfacePressureHpa: 1000,
      cloudCoverPercent: 50,
      cinJkg: -5,
    })
    expect(transformed[1]).toMatchObject({ precipitationMm: 2, globalRadiationWm2: 1 })
    expect(transformed[2]).toMatchObject({ precipitationMm: null, globalRadiationWm2: null })
    expect(transformed[2]!.dataWarnings.join(' ')).toContain('accumulation reset')
  })

  it('turns mismatched arrays and physically invalid values into missing data warnings', () => {
    const response: TimeseriesResponse = {
      reference_time: '2026-01-01T11:45:00Z',
      timestamps: ['2026-01-01T12:00:00Z', '2026-01-01T12:15:00Z'],
      features: [
        feature(15.466, 47.199, {
          dd: [400],
          ff: [-1, 2],
          fx: [3, 4],
          rh2m: [101, 50],
          rr: [-1, 0],
          t2m: [10, 11],
          td: [5, 6],
        }),
      ],
    }
    const points = transformNowcast(response, fetchedAtMs, 'https://example.test/nowcast').schoeckl
    expect(points[0]).toMatchObject({
      windFromDeg: null,
      meanWindMps: null,
      relativeHumidityPercent: null,
      precipitationMm: null,
    })
    expect(points[0]!.dataWarnings.join(' ')).toContain('did not align')
    expect(points[0]!.dataWarnings.join(' ')).toContain('invalid negative')
  })
})

describe('official warnings', () => {
  it('converts epoch seconds and preserves official plain-text fields', () => {
    const response: RawWarningResponse = {
      properties: {
        location: { properties: { gemeindenr: 60642 } },
        warnings: [
          {
            properties: {
              warntypid: 5,
              warnstufeid: 2,
              begin: '01.01.2026 12:00',
              end: '01.01.2026 13:00',
              text: '<b>Official text stays text</b>',
              auswirkungen: 'Effects',
              empfehlungen: 'Recommendations',
              rawinfo: { wtype: 5, wlevel: 2, start: '1767268800', end: '1767272400' },
            },
          },
        ],
      },
    }
    const result = transformWarnings(response, 'schoeckl', fetchedAtMs, 'https://example.test/warnings')
    expect(result.municipalityNumber).toBe('60642')
    expect(result.warnings[0]).toMatchObject({
      text: '<b>Official text stays text</b>',
      effects: 'Effects',
      recommendations: 'Recommendations',
      startTimeMs: 1_767_268_800_000,
      endTimeMs: 1_767_272_400_000,
      machineReadableIntervalAvailable: true,
    })
  })

  it('retains provider interval text when epoch values are invalid', () => {
    const response: RawWarningResponse = {
      properties: {
        location: { properties: { gemeindenr: '60642' } },
        warnings: [
          {
            properties: {
              begin: 'provider begin',
              end: 'provider end',
              text: 'Warning',
              rawinfo: { start: 'invalid', end: null },
            },
          },
        ],
      },
    }
    const warning = transformWarnings(response, 'schoeckl', fetchedAtMs, 'source').warnings[0]!
    expect(warning).toMatchObject({
      startTimeMs: null,
      endTimeMs: null,
      providerBeginText: 'provider begin',
      providerEndText: 'provider end',
      machineReadableIntervalAvailable: false,
    })
  })

  it('matches automated thunderstorms using gemeinde spelling without mapping severity', () => {
    const response: ThunderstormResponse = {
      features: [{ properties: { gemeinde: 60642, intensity: 'provider-high' } }],
    }
    expect(
      transformThunderstormStatus(response, 'schoeckl', '60642', fetchedAtMs, 'source'),
    ).toMatchObject({ active: true, rawIntensity: 'provider-high' })
  })
})
