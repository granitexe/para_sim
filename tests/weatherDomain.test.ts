import { describe, expect, it } from 'vitest'
import { sites } from '../src/domain/sites'
import {
  comparisonFreshness,
  destinationCoordinate,
  haversineCoordinateDistanceM,
  vectorWindFromUv,
} from '../src/domain/weather'

describe('public weather sites', () => {
  it('uses only the reviewed public coordinates and direct-station assignment', () => {
    expect(sites.schoeckl).toMatchObject({
      latitude: 47.1986111111,
      longitude: 15.4663888889,
      elevationM: 1443,
      directStationId: '11241',
    })
    expect(sites.gelderkogel).toMatchObject({
      latitude: 47.310512,
      longitude: 15.47899,
      elevationM: 1195,
      directStationId: null,
    })
    expect(sites.gelderkogel.rules.url).toBe(
      'https://www.paragleitclub-steiermark.at/wp/fluggebiet-gelderkogel/',
    )
    expect(sites.gelderkogel.notes.en.join(' ')).toContain('Thalerhof')
  })
})

describe('weather geometry and freshness', () => {
  it('turns u=3, v=4 into 5 m/s from approximately 216.9 degrees', () => {
    expect(vectorWindFromUv(3, 4)).toEqual({
      speedMps: 5,
      fromDegrees: expect.closeTo(216.86989765, 7),
    })
    expect(vectorWindFromUv(0, 0)).toEqual({ speedMps: 0, fromDegrees: null })
  })

  it('draws DD=180 toward north as a downwind vector', () => {
    const start = { latitude: 47, longitude: 15 }
    const endpoint = destinationCoordinate(start, (180 + 180) % 360, 1500)
    expect(endpoint.latitude).toBeGreaterThan(start.latitude)
    expect(endpoint.longitude).toBeCloseTo(start.longitude, 7)
    expect(haversineCoordinateDistanceM(start, endpoint)).toBeCloseTo(1500, 4)
  })

  it('enforces comparison cutoffs without suppressing viewable stale data', () => {
    const now = Date.UTC(2026, 0, 1, 12)
    expect(comparisonFreshness('observation', now - 20 * 60_000, now)).toBe('fresh')
    expect(comparisonFreshness('observation', now - 20 * 60_000 - 1, now)).toBe('stale')
    expect(comparisonFreshness('nowcast', now - 45 * 60_000, now)).toBe('fresh')
    expect(comparisonFreshness('nowcast', now - 45 * 60_000 - 1, now)).toBe('stale')
    expect(comparisonFreshness('nwp', now - 6 * 60 * 60_000, now)).toBe('fresh')
    expect(comparisonFreshness('nwp', now - 6 * 60 * 60_000 - 1, now)).toBe('stale')
    expect(comparisonFreshness('nwp', null, now)).toBe('missing')
  })
})
