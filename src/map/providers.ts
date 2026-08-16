import 'cesium/Build/Cesium/Widgets/widgets.css'
import {
  Credit,
  EllipsoidTerrainProvider,
  TileMapServiceImageryProvider,
  UrlTemplateImageryProvider,
  type ImageryProvider,
  type TerrainProvider,
} from 'cesium'

export type ProviderPolicy = 'local' | 'topographic' | 'aviation' | 'maptiler'
export type ProviderDegradedReason = 'missing-key' | 'provider-error' | null

export interface ProviderBundle {
  imageryProviders: ImageryProvider[]
  terrainProvider: TerrainProvider
  effectivePolicy: ProviderPolicy
  degradedReason: ProviderDegradedReason
}

const naturalEarthCredit = new Credit('Natural Earth II · bundled with Cesium', true)
const openTopoCredit = new Credit(
  '<a href="https://www.opentopomap.org/about" target="_blank" rel="noopener noreferrer"><strong>© OpenTopoMap</strong></a> (CC-BY-SA) · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a> · SRTM',
  true,
)
const openFlightMapsCredit = new Credit(
  '<a href="https://openflightmaps.org/" target="_blank" rel="noopener noreferrer"><strong>© open flightmaps association</strong></a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a> · NASA elevation data',
  true,
)
const mapTilerCredit = new Credit(
  '<a href="https://www.maptiler.com/copyright/" target="_blank" rel="noopener noreferrer"><strong>MapTiler</strong></a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a>',
  true,
)

export interface MapTilerUrls {
  imagery: string
}

export interface OpenMapUrls {
  topographic: string
  aviationBase: string
  aviationOverlay: string
  airac: string
}

const airacCycleMs = 28 * 24 * 60 * 60 * 1_000
const airacCyclesPerYear = 13
const airac2601StartMs = Date.UTC(2026, 0, 22)

export function currentAiracCycle(nowMs = Date.now()): string {
  const elapsedCycles = Math.floor((nowMs - airac2601StartMs) / airacCycleMs)
  const yearOffset = Math.floor(elapsedCycles / airacCyclesPerYear)
  const zeroBasedCycle =
    ((elapsedCycles % airacCyclesPerYear) + airacCyclesPerYear) % airacCyclesPerYear
  const year = 2026 + yearOffset
  return `${String(year % 100).padStart(2, '0')}${String(zeroBasedCycle + 1).padStart(2, '0')}`
}

export function openMapUrls(nowMs = Date.now()): OpenMapUrls {
  const airac = currentAiracCycle(nowMs)
  return {
    topographic: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    aviationBase:
      `https://nwy-tiles-api.prod.newaydata.com/tiles/{z}/{x}/{y}.jpg?path=${airac}/base/latest`,
    aviationOverlay:
      `https://nwy-tiles-api.prod.newaydata.com/tiles/{z}/{x}/{y}.png?path=${airac}/aero/latest`,
    airac,
  }
}

export function mapTilerUrls(key: string): MapTilerUrls {
  const encodedKey = encodeURIComponent(key)
  return {
    imagery: `https://api.maptiler.com/maps/satellite-v4/{z}/{x}/{y}.jpg?key=${encodedKey}`,
  }
}

export function mapTilerConfigured(): boolean {
  return (import.meta.env.VITE_MAPTILER_KEY ?? '').trim().length > 0
}

export async function createLocalProviders(): Promise<ProviderBundle> {
  const imageryProvider = await TileMapServiceImageryProvider.fromUrl(
    new URL('Assets/Textures/NaturalEarthII', window.CESIUM_BASE_URL).href,
    { credit: naturalEarthCredit },
  )
  return {
    imageryProviders: [imageryProvider],
    terrainProvider: new EllipsoidTerrainProvider(),
    effectivePolicy: 'local',
    degradedReason: null,
  }
}

function createTopographicProviders(): ProviderBundle {
  const urls = openMapUrls()
  return {
    imageryProviders: [
      new UrlTemplateImageryProvider({
        url: urls.topographic,
        subdomains: ['a', 'b', 'c'],
        credit: openTopoCredit,
        minimumLevel: 0,
        maximumLevel: 17,
        tileWidth: 256,
        tileHeight: 256,
        enablePickFeatures: false,
      }),
    ],
    terrainProvider: new EllipsoidTerrainProvider(),
    effectivePolicy: 'topographic',
    degradedReason: null,
  }
}

function createAviationProviders(): ProviderBundle {
  const urls = openMapUrls()
  return {
    imageryProviders: [
      new UrlTemplateImageryProvider({
        url: urls.aviationBase,
        credit: openFlightMapsCredit,
        minimumLevel: 0,
        maximumLevel: 12,
        tileWidth: 512,
        tileHeight: 512,
        hasAlphaChannel: false,
        enablePickFeatures: false,
      }),
      new UrlTemplateImageryProvider({
        url: urls.aviationOverlay,
        credit: openFlightMapsCredit,
        minimumLevel: 0,
        maximumLevel: 13,
        tileWidth: 512,
        tileHeight: 512,
        hasAlphaChannel: true,
        enablePickFeatures: false,
      }),
    ],
    terrainProvider: new EllipsoidTerrainProvider(),
    effectivePolicy: 'aviation',
    degradedReason: null,
  }
}

export async function createProviderBundle(
  policy: ProviderPolicy,
): Promise<ProviderBundle> {
  if (policy === 'local') return createLocalProviders()
  if (policy === 'topographic') return createTopographicProviders()
  if (policy === 'aviation') return createAviationProviders()

  const key = (import.meta.env.VITE_MAPTILER_KEY ?? '').trim()
  if (key.length === 0) {
    const local = await createLocalProviders()
    return { ...local, degradedReason: 'missing-key' }
  }

  const urls = mapTilerUrls(key)
  try {
    const imageryProvider = new UrlTemplateImageryProvider({
      url: urls.imagery,
      credit: mapTilerCredit,
      minimumLevel: 0,
      maximumLevel: 20,
      tileWidth: 512,
      tileHeight: 512,
      hasAlphaChannel: false,
      enablePickFeatures: false,
    })
    const terrainProvider = new EllipsoidTerrainProvider()
    return {
      imageryProviders: [imageryProvider],
      terrainProvider,
      effectivePolicy: 'maptiler',
      degradedReason: null,
    }
  } catch {
    const local = await createLocalProviders()
    return { ...local, degradedReason: 'provider-error' }
  }
}
