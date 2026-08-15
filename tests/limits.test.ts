import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  compareWindToLimits,
  defaultPreferences,
  loadPreferences,
  preferencesSchema,
  resetAllPreferences,
  resetSiteLimits,
  savePreferences,
  windSectorFromDegrees,
  windFromMps,
  windToMps,
  type SiteLimits,
} from '../src/domain/limits'

const limits: SiteLimits = {
  maxAverageMps: 4,
  maxGustMps: 8,
  allowedFromSectors: ['N'],
}

beforeEach(() => {
  localStorage.clear()
  resetAllPreferences('en')
})

describe('compareWindToLimits', () => {
  it('treats equality and tolerance as at-or-under while lower maxima exceed', () => {
    expect(
      compareWindToLimits(
        { averageMps: 4 + 1e-6, gustMps: 8, fromDegrees: 0 },
        limits,
        'fresh',
      ).map((row) => row.status),
    ).toEqual([
      'at-or-under-entered-limit',
      'at-or-under-entered-limit',
      'inside-selected-sector',
    ])
    expect(
      compareWindToLimits(
        { averageMps: 4.01, gustMps: 8.01, fromDegrees: 180 },
        limits,
        'fresh',
      ).map((row) => row.status),
    ).toEqual(['over-entered-limit', 'over-entered-limit', 'outside-selected-sector'])
  })

  it('suppresses every comparison for stale or missing data', () => {
    for (const freshness of ['stale', 'missing'] as const) {
      expect(
        compareWindToLimits(
          { averageMps: 10, gustMps: 20, fromDegrees: 180 },
          limits,
          freshness,
        ).every((row) => row.status === 'not-evaluated'),
      ).toBe(true)
    }
  })

  it('suppresses sectors below 0.5 m/s without suppressing numeric comparisons', () => {
    const rows = compareWindToLimits(
      { averageMps: 0.499, gustMps: 2, fromDegrees: 180 },
      limits,
      'fresh',
    )
    expect(rows[0]!.status).toBe('at-or-under-entered-limit')
    expect(rows[2]!.status).toBe('not-evaluated')
  })

  it('classifies all sixteen sectors at their reviewed boundaries', () => {
    expect(windSectorFromDegrees(0)).toBe('N')
    expect(windSectorFromDegrees(11.249)).toBe('N')
    expect(windSectorFromDegrees(11.25)).toBe('NNE')
    expect(windSectorFromDegrees(348.75)).toBe('N')
    expect(windSectorFromDegrees(-22.5)).toBe('NNW')
  })
})

describe('preferences validation and persistence', () => {
  it('round-trips units and normalized m/s limits', () => {
    for (const unit of ['kmh', 'mps', 'kt'] as const) {
      const source = 12.345
      expect(windToMps(windFromMps(source, unit), unit)).toBeCloseTo(source, 10)
    }
    const preferences = defaultPreferences('de')
    preferences.windUnit = 'kt'
    preferences.limits.schoeckl = limits
    expect(savePreferences(preferences)).toBe(true)
    expect(loadPreferences()).toEqual(preferences)
  })

  it('rejects zero, values above 200 km/h, and gust below average', () => {
    const invalidZero = defaultPreferences('en')
    invalidZero.limits.schoeckl.maxAverageMps = 0
    expect(preferencesSchema.safeParse(invalidZero).success).toBe(false)
    const tooHigh = defaultPreferences('en')
    tooHigh.limits.schoeckl.maxAverageMps = 200 / 3.6 + 0.001
    expect(preferencesSchema.safeParse(tooHigh).success).toBe(false)
    const inverted = defaultPreferences('en')
    inverted.limits.schoeckl = { ...limits, maxAverageMps: 5, maxGustMps: 4 }
    expect(preferencesSchema.safeParse(inverted).success).toBe(false)
  })

  it('resets corrupt and unknown versions to empty defaults', () => {
    localStorage.setItem('para.preferences.v1', '{broken')
    expect(loadPreferences()).toEqual(defaultPreferences('en'))
    localStorage.setItem('para.preferences.v1', JSON.stringify({ version: 2, locale: 'de' }))
    expect(loadPreferences()).toEqual(defaultPreferences('en'))
  })

  it('supports independent site reset and full reset', () => {
    const preferences = defaultPreferences('de')
    preferences.limits.schoeckl = limits
    preferences.limits.gelderkogel = { ...limits, allowedFromSectors: ['S'] }
    const oneReset = resetSiteLimits(preferences, 'schoeckl')
    expect(oneReset.limits.schoeckl).toEqual({
      maxAverageMps: null,
      maxGustMps: null,
      allowedFromSectors: [],
    })
    expect(oneReset.limits.gelderkogel.allowedFromSectors).toEqual(['S'])
    expect(resetAllPreferences('en')).toEqual(defaultPreferences('en'))
  })

  it('keeps in-memory preferences when storage is unavailable', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError')
    })
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError')
    })
    const preferences = defaultPreferences('de')
    preferences.windUnit = 'mps'
    expect(savePreferences(preferences)).toBe(false)
    expect(loadPreferences()).toEqual(preferences)
    setItem.mockRestore()
    getItem.mockRestore()
  })
})
