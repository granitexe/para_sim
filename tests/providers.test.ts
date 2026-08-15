import { describe, expect, it } from 'vitest'
import { mapTilerUrls } from '../src/map/providers'

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
