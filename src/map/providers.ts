import 'cesium/Build/Cesium/Widgets/widgets.css'
import {
  CesiumTerrainProvider,
  Credit,
  EllipsoidTerrainProvider,
  TileMapServiceImageryProvider,
  UrlTemplateImageryProvider,
  type ImageryProvider,
  type TerrainProvider,
} from 'cesium'

export type ProviderPolicy = 'local' | 'online'
export type ProviderDegradedReason = 'missing-key' | 'provider-error' | null

export interface ProviderBundle {
  imageryProvider: ImageryProvider
  terrainProvider: TerrainProvider
  effectivePolicy: ProviderPolicy
  degradedReason: ProviderDegradedReason
}

const naturalEarthCredit = new Credit('Natural Earth II · bundled with Cesium', true)
const mapTilerCredit = new Credit(
  '<a href="https://www.maptiler.com/copyright/" target="_blank" rel="noopener noreferrer"><strong>MapTiler</strong></a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a>',
  true,
)

export interface MapTilerUrls {
  imagery: string
  terrain: string
}

export function mapTilerUrls(key: string): MapTilerUrls {
  const encodedKey = encodeURIComponent(key)
  return {
    imagery: `https://api.maptiler.com/maps/satellite-v4/{z}/{x}/{y}.jpg?key=${encodedKey}`,
    terrain: `https://api.maptiler.com/tiles/terrain-quantized-mesh-v2/?key=${encodedKey}`,
  }
}

export async function createLocalProviders(): Promise<ProviderBundle> {
  const imageryProvider = await TileMapServiceImageryProvider.fromUrl(
    new URL('Assets/Textures/NaturalEarthII', window.CESIUM_BASE_URL).href,
    { credit: naturalEarthCredit },
  )
  return {
    imageryProvider,
    terrainProvider: new EllipsoidTerrainProvider(),
    effectivePolicy: 'local',
    degradedReason: null,
  }
}

export async function createProviderBundle(policy: ProviderPolicy): Promise<ProviderBundle> {
  if (policy === 'local') return createLocalProviders()

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
    const terrainProvider = await CesiumTerrainProvider.fromUrl(urls.terrain, {
      requestVertexNormals: true,
      credit: mapTilerCredit,
    })
    return {
      imageryProvider,
      terrainProvider,
      effectivePolicy: 'online',
      degradedReason: null,
    }
  } catch {
    const local = await createLocalProviders()
    return { ...local, degradedReason: 'provider-error' }
  }
}
