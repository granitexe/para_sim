import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BoundingSphere,
  Cartesian2,
  Cartesian3,
  Color,
  DistanceDisplayCondition,
  Entity,
  HeadingPitchRange,
  HeightReference,
  HorizontalOrigin,
  Math as CesiumMath,
  Matrix4,
  PolylineArrowMaterialProperty,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  VerticalOrigin,
  type Viewer,
} from 'cesium'
import type { WindUnit } from '../../domain/limits'
import { sites, siteIds, type SiteId } from '../../domain/sites'
import { destinationCoordinate, type StationMeta, type StationObservation } from '../../domain/weather'
import { useI18n } from '../../i18n/I18nProvider'
import {
  createCesiumViewer,
  destroyCesiumViewer,
  WebglUnavailableError,
  type CesiumViewerHandle,
  type CesiumViewerStatus,
} from '../../map/cesiumViewer'
import { formatWind } from './formatWeather'

interface WeatherMapProps {
  siteId: SiteId
  stations: StationMeta[]
  observations: StationObservation[]
  selectedStationId: string | null
  windUnit: WindUnit
  nowMs: number
  onSelectStation: (stationId: string) => void
}

function frameSphere(viewer: Viewer, sphere: BoundingSphere, reducedMotion: boolean): void {
  const offset = new HeadingPitchRange(
    0,
    CesiumMath.toRadians(-52),
    Math.max(sphere.radius * 2.4, 35_000),
  )
  if (reducedMotion) {
    viewer.camera.viewBoundingSphere(sphere, offset)
    viewer.camera.lookAtTransform(Matrix4.IDENTITY)
    viewer.scene.requestRender()
  } else {
    void viewer.camera.flyToBoundingSphere(sphere, { duration: 0.8, offset })
  }
}

export function WeatherMap({
  siteId,
  stations,
  observations,
  selectedStationId,
  windUnit,
  nowMs,
  onSelectStation,
}: WeatherMapProps) {
  const { locale, t } = useI18n()
  const containerRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<CesiumViewerHandle | null>(null)
  const stationByEntity = useRef(new Map<Entity, string>())
  const initialFrameComplete = useRef(false)
  const previousSiteId = useRef<SiteId | null>(null)
  const onSelectRef = useRef(onSelectStation)
  const [readyVersion, setReadyVersion] = useState(0)
  const [status, setStatus] = useState<CesiumViewerStatus | null>(null)
  const [mapError, setMapError] = useState<'webgl' | 'initialization' | null>(null)
  const reducedMotion = useMemo(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  )

  useEffect(() => {
    onSelectRef.current = onSelectStation
  }, [onSelectStation])

  useEffect(() => {
    let cancelled = false
    const initialize = async () => {
      const container = containerRef.current
      if (container === null) return
      let handle: CesiumViewerHandle
      try {
        handle = await createCesiumViewer(container, 'weather', 'online', (nextStatus) => {
          if (!cancelled) setStatus(nextStatus)
        })
      } catch (error) {
        if (!cancelled) {
          setMapError(error instanceof WebglUnavailableError ? 'webgl' : 'initialization')
        }
        return
      }
      if (cancelled) {
        destroyCesiumViewer(handle)
        return
      }
      handleRef.current = handle
      const clickHandler = new ScreenSpaceEventHandler(handle.viewer.scene.canvas)
      clickHandler.setInputAction((movement: { position: Cartesian2 }) => {
        const picked = handle.viewer.scene.pick(movement.position) as { id?: unknown } | undefined
        if (!(picked?.id instanceof Entity)) return
        const stationId = stationByEntity.current.get(picked.id)
        if (stationId !== undefined) onSelectRef.current(stationId)
      }, ScreenSpaceEventType.LEFT_CLICK)
      const originalDestroy = handle.destroy
      handle.destroy = () => {
        if (!clickHandler.isDestroyed()) clickHandler.destroy()
        originalDestroy()
      }
      setReadyVersion((version) => version + 1)
    }
    void initialize()
    return () => {
      cancelled = true
      stationByEntity.current.clear()
      destroyCesiumViewer(handleRef.current)
      handleRef.current = null
    }
  }, [])

  useEffect(() => {
    const viewer = handleRef.current?.viewer
    if (viewer === undefined) return
    viewer.entities.removeAll()
    stationByEntity.current.clear()
    const observationByStation = new Map(
      observations.map((observation) => [observation.stationId, observation]),
    )
    const framingPositions: Cartesian3[] = []

    for (const configuredSiteId of siteIds) {
      const site = sites[configuredSiteId]
      const position = Cartesian3.fromDegrees(site.longitude, site.latitude)
      framingPositions.push(position)
      viewer.entities.add({
        name: site.name[locale],
        position,
        point: {
          color: Color.fromCssColorString('#FFB454'),
          pixelSize: configuredSiteId === siteId ? 14 : 10,
          heightReference: HeightReference.CLAMP_TO_GROUND,
          outlineColor: Color.fromCssColorString('#0B1117'),
          outlineWidth: 2,
        },
        label: {
          text: site.name[locale],
          font: '700 15px system-ui',
          fillColor: Color.WHITE,
          showBackground: true,
          backgroundColor: Color.fromCssColorString('#0B1117').withAlpha(0.82),
          pixelOffset: new Cartesian2(0, -28),
          horizontalOrigin: HorizontalOrigin.CENTER,
          verticalOrigin: VerticalOrigin.BOTTOM,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      })
    }

    for (const station of stations) {
      const observation = observationByStation.get(station.id)
      if (observation === undefined) continue
      const position = Cartesian3.fromDegrees(
        station.coordinate.longitude,
        station.coordinate.latitude,
      )
      framingPositions.push(position)
      const stale = nowMs - observation.observationTimeMs > 20 * 60 * 1_000
      const color = stale
        ? Color.fromCssColorString('#9AA4AC').withAlpha(0.55)
        : Color.fromCssColorString('#6ED5E6')
      const badge = `${formatWind(observation.meanWindMps, windUnit)} / ${formatWind(observation.gustMps, windUnit)}`
      const marker = viewer.entities.add({
        name: station.name,
        position,
        point: {
          color,
          pixelSize: selectedStationId === station.id ? 13 : 10,
          heightReference: HeightReference.CLAMP_TO_GROUND,
          outlineColor: Color.fromCssColorString('#0B1117'),
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: badge,
          font: '700 13px system-ui',
          fillColor: Color.WHITE,
          showBackground: true,
          backgroundColor: Color.fromCssColorString('#0B1117').withAlpha(0.84),
          pixelOffset: new Cartesian2(0, -22),
          distanceDisplayCondition: new DistanceDisplayCondition(0, 80_000),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      })
      stationByEntity.current.set(marker, station.id)

      if (
        observation.windFromDeg !== null &&
        observation.meanWindMps !== null &&
        observation.meanWindMps >= 0.5
      ) {
        const endpoint = destinationCoordinate(
          station.coordinate,
          (observation.windFromDeg + 180) % 360,
          1_500,
        )
        const arrow = viewer.entities.add({
          name: station.name,
          polyline: {
            positions: [
              position,
              Cartesian3.fromDegrees(endpoint.longitude, endpoint.latitude),
            ],
            width: Math.min(8, Math.max(3, 3 + observation.meanWindMps / 2)),
            material: new PolylineArrowMaterialProperty(color),
            clampToGround: true,
          },
        })
        stationByEntity.current.set(arrow, station.id)
      }
    }

    if (!initialFrameComplete.current && framingPositions.length > 0) {
      initialFrameComplete.current = true
      frameSphere(viewer, BoundingSphere.fromPoints(framingPositions), reducedMotion)
    } else if (previousSiteId.current !== null && previousSiteId.current !== siteId) {
      const site = sites[siteId]
      frameSphere(
        viewer,
        new BoundingSphere(Cartesian3.fromDegrees(site.longitude, site.latitude), 45_000),
        reducedMotion,
      )
    }
    previousSiteId.current = siteId
    viewer.scene.requestRender()
  }, [
    locale,
    nowMs,
    observations,
    readyVersion,
    reducedMotion,
    selectedStationId,
    siteId,
    stations,
    windUnit,
  ])

  const stationCount = observations.length
  const summary =
    locale === 'de'
      ? `${stationCount} benannte Punktstationen im Umkreis; keine räumliche Interpolation.`
      : `${stationCount} named point stations in range; no spatial interpolation.`

  return (
    <section className="weather-map" aria-labelledby="weather-map-heading">
      <h2 id="weather-map-heading" className="sr-only">{t('stationObservations')}</h2>
      <p className="sr-only">{summary}</p>
      <div className="map-panel">
        {mapError === null ? (
          <div
            ref={containerRef}
            className="cesium-container"
            role="region"
            aria-label={`${t('stationObservations')}. ${summary}`}
          />
        ) : (
          <div className="map-text-fallback" role="status">
            <h2>{t('stationObservations')}</h2>
            <p>{mapError === 'webgl' ? t('webglUnavailable') : t('mapUnavailable')}</p>
            <p>{summary}</p>
          </div>
        )}
        {status === null && mapError === null ? (
          <p className="map-loading">{locale === 'de' ? 'Wetterkarte wird geladen…' : 'Loading weather map…'}</p>
        ) : null}
        <div className="map-legend">
          <strong>{locale === 'de' ? 'Punktmessungen' : 'Point observations'}</strong>
          <span>{t('directionLegend')}</span>
        </div>
      </div>
      {status?.degradedReason !== null && status?.degradedReason !== undefined ? (
        <p className="map-status" role="status">{t('mapUnavailable')}</p>
      ) : null}
    </section>
  )
}
