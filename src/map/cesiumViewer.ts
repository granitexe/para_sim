import {
  ImageryLayer,
  Ion,
  SceneMode,
  Viewer,
  type Event as CesiumEvent,
} from 'cesium'
import {
  createLocalProviders,
  createProviderBundle,
  type ProviderDegradedReason,
  type ProviderPolicy,
} from './providers'

export type MapMode = 'flight' | 'weather'

export class WebglUnavailableError extends Error {
  constructor() {
    super('WebGL is unavailable.')
    this.name = 'WebglUnavailableError'
  }
}

export interface CesiumViewerStatus {
  policy: ProviderPolicy
  degradedReason: ProviderDegradedReason
}

export interface CesiumViewerHandle {
  viewer: Viewer
  status: CesiumViewerStatus
  destroy: () => void
}

function supportsWebgl(): boolean {
  const canvas = document.createElement('canvas')
  try {
    return Boolean(
      canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: true }) ??
        canvas.getContext('webgl', { failIfMajorPerformanceCaveat: true }),
    )
  } catch {
    return false
  }
}

export async function createCesiumViewer(
  container: HTMLElement,
  mode: MapMode,
  providerPolicy: ProviderPolicy,
  onStatus?: (status: CesiumViewerStatus) => void,
): Promise<CesiumViewerHandle> {
  if (!supportsWebgl()) throw new WebglUnavailableError()

  Ion.defaultAccessToken = ''
  const providers = await createProviderBundle(providerPolicy)
  const viewer = new Viewer(container, {
    baseLayer: new ImageryLayer(providers.imageryProviders[0]!),
    terrainProvider: providers.terrainProvider,
    animation: false,
    baseLayerPicker: false,
    fullscreenButton: false,
    geocoder: false,
    homeButton: false,
    infoBox: false,
    navigationHelpButton: false,
    scene3DOnly: true,
    sceneMode: SceneMode.SCENE3D,
    sceneModePicker: false,
    selectionIndicator: false,
    timeline: false,
    useBrowserRecommendedResolution: false,
    vrButton: false,
  })
  for (const imageryProvider of providers.imageryProviders.slice(1)) {
    viewer.imageryLayers.addImageryProvider(imageryProvider)
  }
  container.dataset.mapMode = mode
  viewer.scene.globe.depthTestAgainstTerrain = true
  viewer.scene.globe.enableLighting = true
  viewer.resolutionScale = Math.min(window.devicePixelRatio || 1, 1.5)

  const removalCallbacks: Array<() => void> = []
  let destroyed = false
  let fallbackStarted = false
  let fallbackCompleted = false
  const status: CesiumViewerStatus = {
    policy: providers.effectivePolicy,
    degradedReason: providers.degradedReason,
  }
  onStatus?.({ ...status })

  const switchBothProvidersToLocal = async () => {
    if (fallbackStarted || fallbackCompleted || destroyed) return
    fallbackStarted = true
    try {
      const local = await createLocalProviders()
      if (destroyed || viewer.isDestroyed()) return
      viewer.scene.globe.show = false
      viewer.imageryLayers.removeAll(true)
      for (const imageryProvider of local.imageryProviders) {
        viewer.imageryLayers.addImageryProvider(imageryProvider)
      }
      viewer.terrainProvider = local.terrainProvider
      viewer.scene.globe.show = true
      status.policy = 'local'
      status.degradedReason = 'provider-error'
      onStatus?.({ ...status })
      viewer.scene.requestRender()
      fallbackCompleted = true
    } finally {
      fallbackStarted = false
    }
  }

  const listenForProviderFailure = (event: CesiumEvent) => {
    const remove = event.addEventListener(() => {
      void switchBothProvidersToLocal()
    })
    removalCallbacks.push(remove)
  }
  if (providers.effectivePolicy !== 'local') {
    for (const imageryProvider of providers.imageryProviders) {
      listenForProviderFailure(imageryProvider.errorEvent)
    }
    listenForProviderFailure(providers.terrainProvider.errorEvent)
  }

  const destroy = () => {
    if (destroyed) return
    destroyed = true
    for (const remove of removalCallbacks) remove()
    removalCallbacks.length = 0
    if (!viewer.isDestroyed()) {
      viewer.trackedEntity = undefined
      viewer.destroy()
    }
  }

  return { viewer, status, destroy }
}

export function destroyCesiumViewer(handle: CesiumViewerHandle | null | undefined): void {
  handle?.destroy()
}
