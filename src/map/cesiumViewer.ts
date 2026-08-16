import {
  ImageryLayer,
  Ion,
  SceneMode,
  Viewer,
  type Event as CesiumEvent,
  type TileProviderError,
} from 'cesium'
import {
  createLocalProviders,
  createProviderBundle,
  type ProviderBundle,
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
  setProviderPolicy: (policy: ProviderPolicy) => Promise<void>
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

  const providerRemovalCallbacks: Array<() => void> = []
  let destroyed = false
  let providerChangeSequence = 0
  let fallbackStarted = false
  const status: CesiumViewerStatus = {
    policy: providers.effectivePolicy,
    degradedReason: providers.degradedReason,
  }

  const publishStatus = () => {
    onStatus?.({ ...status })
  }

  const clearProviderListeners = () => {
    for (const remove of providerRemovalCallbacks) remove()
    providerRemovalCallbacks.length = 0
  }

  const applyProviderBundle = (
    nextProviders: ProviderBundle,
    degradedReason = nextProviders.degradedReason,
  ) => {
    if (destroyed || viewer.isDestroyed()) return
    clearProviderListeners()
    viewer.scene.globe.show = false
    viewer.imageryLayers.removeAll(true)
    for (const imageryProvider of nextProviders.imageryProviders) {
      viewer.imageryLayers.addImageryProvider(imageryProvider)
    }
    viewer.terrainProvider = nextProviders.terrainProvider
    viewer.scene.globe.show = true
    status.policy = nextProviders.effectivePolicy
    status.degradedReason = degradedReason
    installProviderFailureListeners(nextProviders)
    publishStatus()
    viewer.scene.requestRender()
  }

  async function switchBothProvidersToLocal(): Promise<void> {
    if (fallbackStarted || destroyed) return
    fallbackStarted = true
    const sequence = ++providerChangeSequence
    try {
      const local = await createLocalProviders()
      if (destroyed || sequence !== providerChangeSequence) return
      applyProviderBundle(local, 'provider-error')
    } finally {
      fallbackStarted = false
    }
  }

  const listenForProviderFailure = (event: CesiumEvent) => {
    const remove = event.addEventListener((error: TileProviderError) => {
      if (error.timesRetried < 1) {
        error.retry = true
        return
      }
      void switchBothProvidersToLocal()
    })
    providerRemovalCallbacks.push(remove)
  }

  function installProviderFailureListeners(nextProviders: ProviderBundle): void {
    if (nextProviders.effectivePolicy !== 'maptiler') return
    for (const imageryProvider of nextProviders.imageryProviders) {
      listenForProviderFailure(imageryProvider.errorEvent)
    }
    listenForProviderFailure(nextProviders.terrainProvider.errorEvent)
  }

  const setProviderPolicy = async (policy: ProviderPolicy) => {
    const sequence = ++providerChangeSequence
    const nextProviders = await createProviderBundle(policy)
    if (destroyed || sequence !== providerChangeSequence) return
    applyProviderBundle(nextProviders)
  }

  installProviderFailureListeners(providers)
  publishStatus()

  const destroy = () => {
    if (destroyed) return
    destroyed = true
    providerChangeSequence += 1
    clearProviderListeners()
    if (!viewer.isDestroyed()) {
      viewer.trackedEntity = undefined
      viewer.destroy()
    }
  }

  return { viewer, status, setProviderPolicy, destroy }
}

export function destroyCesiumViewer(handle: CesiumViewerHandle | null | undefined): void {
  handle?.destroy()
}
