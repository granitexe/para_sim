import { describe, expect, it } from 'vitest'
import {
  aloftRowsAboveSite,
  transformOpenMeteoAloft,
  type OpenMeteoLocation,
  type OpenMeteoResponse,
} from '../src/services/openMeteoClient'

function location(
  latitude: number,
  longitude: number,
  height850: Array<number | null>,
  speed850: Array<number | null> = [4, 0],
): OpenMeteoLocation {
  return {
    latitude,
    longitude,
    elevation: 1400,
    timezone: 'GMT',
    hourly: {
      time: ['2026-01-01T12:00', '2026-01-01T13:00'],
      wind_speed_850hPa: speed850,
      wind_direction_850hPa: [180, 270],
      geopotential_height_850hPa: height850,
      wind_speed_800hPa: [5, 6],
      wind_direction_800hPa: [190, 200],
      geopotential_height_800hPa: [2000, 2010],
      wind_speed_700hPa: [7, 8],
      wind_direction_700hPa: [210, 220],
      geopotential_height_700hPa: [3000, 3010],
    },
  }
}

describe('Open-Meteo ICON-D2 transform', () => {
  it('matches response locations to the nearest requested site and labels limitations', () => {
    const response: OpenMeteoResponse = [
      location(47.3106, 15.479, [1295, 1294]),
      location(47.1987, 15.4664, [1543, 1542]),
    ]
    const fetchedAtMs = Date.UTC(2026, 0, 1, 11, 50)
    const transformed = transformOpenMeteoAloft(response, fetchedAtMs, 'https://example.test/icon')

    expect(transformed.schoeckl[0]).toMatchObject({
      siteId: 'schoeckl',
      gridCoordinate: { latitude: 47.1987, longitude: 15.4664 },
      modelName: 'DWD ICON-D2 via Open-Meteo',
      modelResolution: 'approximately 2 km',
      referenceTimeMs: null,
      validTimeMs: Date.UTC(2026, 0, 1, 12),
      pressureLevelHpa: 850,
      geopotentialHeightM: 1543,
      windSpeedMps: 4,
      windFromDeg: 180,
      gustMps: null,
    })
    expect(transformed.gelderkogel[0]!.gridCoordinate).toEqual({
      latitude: 47.3106,
      longitude: 15.479,
    })
  })

  it('keeps zero speed but removes its meaningless direction', () => {
    const transformed = transformOpenMeteoAloft(
      location(47.1987, 15.4664, [1543, 1542]),
      Date.UTC(2026, 0, 1),
      'source',
    )
    const calm = transformed.schoeckl.find(
      (point) => point.pressureLevelHpa === 850 && point.validTimeMs === Date.UTC(2026, 0, 1, 13),
    )
    expect(calm).toMatchObject({ windSpeedMps: 0, windFromDeg: null })
  })

  it('includes exactly site elevation plus 100 m and drops one metre below', () => {
    const transformed = transformOpenMeteoAloft(
      location(47.1987, 15.4664, [1543, 1542]),
      Date.UTC(2026, 0, 1),
      'source',
    ).schoeckl.filter((point) => point.pressureLevelHpa === 850)
    const visible = aloftRowsAboveSite(transformed, 1443)
    expect(visible.map((point) => point.geopotentialHeightM)).toEqual([1543])
  })

  it('turns mismatched provider arrays into missing values with warnings', () => {
    const malformed = location(47.1987, 15.4664, [1543, 1542], [4])
    const transformed = transformOpenMeteoAloft(
      malformed,
      Date.UTC(2026, 0, 1),
      'source',
    ).schoeckl
    expect(transformed[0]).toMatchObject({ windSpeedMps: null, windFromDeg: null })
    expect(transformed[0]!.dataWarnings.join(' ')).toContain('did not align')
  })
})
