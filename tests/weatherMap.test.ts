import { describe, expect, it } from 'vitest'
import type { RegionalWindPoint } from '../src/domain/weather'
import { selectWindPointsForMap } from '../src/features/weather/WeatherMap'

function point(latitude: number, longitude: number): RegionalWindPoint {
  return {
    gridCoordinate: { latitude, longitude },
    validTimeMs: 0,
    windFromDeg: 180,
    windSpeedMps: 5,
    dataWarnings: [],
  }
}

describe('weather-map wind sampling', () => {
  it('keeps a small model grid intact', () => {
    const points = [point(47, 15), point(47, 15.1), point(47.1, 15), point(47.1, 15.1)]
    expect(selectWindPointsForMap(points)).toBe(points)
  })

  it('declutters a regular grid without changing source points', () => {
    const points = Array.from({ length: 11 }, (_, row) =>
      Array.from({ length: 17 }, (_, column) => point(47 + row / 100, 15 + column / 100)),
    ).flat()
    const selected = selectWindPointsForMap(points)

    expect(selected.length).toBeLessThanOrEqual(64)
    expect(selected.length).toBeGreaterThan(30)
    expect(selected.every((candidate) => points.includes(candidate))).toBe(true)
    expect(points).toHaveLength(187)
  })
})
