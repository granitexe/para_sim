import { describe, expect, it } from 'vitest'
import { currentAiracCycle, mapTilerUrls, openMapUrls } from '../src/map/providers'

describe('MapTiler public browser URLs', () => {
  it('uses the required products, levels, and encoded key boundary', () => {
    const urls = mapTilerUrls('public key&scope=bad')
    expect(urls.imagery).toBe(
      'https://api.maptiler.com/maps/satellite-v4/{z}/{x}/{y}.jpg?key=public%20key%26scope%3Dbad',
    )
    expect(urls.terrain).toBe(
      'https://api.maptiler.com/tiles/terrain-quantized-mesh-v2/?key=public%20key%26scope%3Dbad',
    )
    expect(urls.imagery).not.toContain('public key')
  })
})

describe('Keyless open map URLs', () => {
  it('uses keyless OpenTopoMap and current-cycle OpenFlightMaps products', () => {
    const urls = openMapUrls(Date.parse('2026-08-15T12:00:00Z'))
    expect(urls).toEqual({
      topographic: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
      aviationBase:
        'https://nwy-tiles-api.prod.newaydata.com/tiles/{z}/{x}/{y}.jpg?path=2608/base/latest',
      aviationOverlay:
        'https://nwy-tiles-api.prod.newaydata.com/tiles/{z}/{x}/{y}.png?path=2608/aero/latest',
      airac: '2608',
    })
  })

  it('advances the AIRAC cycle every 28 days across year boundaries', () => {
    expect(currentAiracCycle(Date.parse('2026-01-22T00:00:00Z'))).toBe('2601')
    expect(currentAiracCycle(Date.parse('2026-08-06T00:00:00Z'))).toBe('2608')
    expect(currentAiracCycle(Date.parse('2027-01-21T00:00:00Z'))).toBe('2701')
  })
})
