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
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  VerticalOrigin,
  type Viewer,
} from 'cesium'
import type { WindUnit } from '../../domain/limits'
import {
  flightAreas,
  siteRestrictions,
  sites,
  siteIds,
  type SiteId,
} from '../../domain/sites'
import type {
  LoadState,
  RegionalWindField,
  RegionalWindPoint,
  StationMeta,
  StationObservation,
} from '../../domain/weather'
import { useI18n } from '../../i18n/I18nProvider'
import {
  createCesiumViewer,
  destroyCesiumViewer,
  WebglUnavailableError,
  type CesiumViewerHandle,
  type CesiumViewerStatus,
} from '../../map/cesiumViewer'
import { addFlightAreaEntities } from '../../map/flightAreas'
import { MapOverlayControls, type MarkerToggleGroup } from '../../map/MapOverlayControls'
import { MapFeatureKey } from '../../map/MapFeatureKey'
import type { ProviderPolicy } from '../../map/providers'
import { formatWind } from './formatWeather'

interface WeatherMapProps {
  siteId: SiteId
  stations: StationMeta[]
  observations: StationObservation[]
  windUnit: WindUnit
  windField: LoadState<RegionalWindField>
  nowMs: number
  onSelectStation: (stationId: string) => void
}

interface MarkerEntitySet {
  visibleEntities: Entity[]
  label: Entity
}

type WeatherMapStyle = Extract<ProviderPolicy, 'topographic' | 'aviation'>

const modelWindImage = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="60" viewBox="0 0 40 60"><path d="M20 2 35 55 20 45 5 55Z" fill="#ff2da8" stroke="#071116" stroke-width="7" stroke-linejoin="round"/><path d="M20 3 33 52 20 43 7 52Z" fill="none" stroke="white" stroke-width="2.5" stroke-linejoin="round"/></svg>',
)}`
const measuredWindImage = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="44" height="56" viewBox="0 0 44 56"><circle cx="22" cy="33" r="18" fill="none" stroke="#071116" stroke-width="6"/><circle cx="22" cy="33" r="18" fill="none" stroke="white" stroke-width="2.5"/><path d="M22 2 36 50 22 40 8 50Z" fill="white" stroke="#071116" stroke-width="5" stroke-linejoin="round"/></svg>',
)}`


export function downwindBillboardRotation(windFromDeg: number): number {
  return -CesiumMath.toRadians((windFromDeg + 180) % 360)
}

export function selectWindPointsForMap(
  points: RegionalWindPoint[],
  targetCount = 64,
): RegionalWindPoint[] {
  if (points.length <= targetCount) return points
  const latitudes = [...new Set(points.map((point) => point.gridCoordinate.latitude))].sort(
    (a, b) => a - b,
  )
  const longitudes = [...new Set(points.map((point) => point.gridCoordinate.longitude))].sort(
    (a, b) => a - b,
  )
  if (latitudes.length * longitudes.length > points.length * 2) {
    const stride = Math.ceil(points.length / targetCount)
    return points.filter((_, index) => index % stride === 0)
  }
  let latitudeStride = 1
  let longitudeStride = 1
  while (
    Math.ceil(latitudes.length / latitudeStride) *
      Math.ceil(longitudes.length / longitudeStride) >
    targetCount
  ) {
    if (
      Math.ceil(longitudes.length / longitudeStride) >=
      Math.ceil(latitudes.length / latitudeStride)
    ) {
      longitudeStride += 1
    } else {
      latitudeStride += 1
    }
  }
  const latitudeIndex = new Map(latitudes.map((latitude, index) => [latitude, index]))
  const longitudeIndex = new Map(longitudes.map((longitude, index) => [longitude, index]))
  return points.filter((point) => {
    const row = latitudeIndex.get(point.gridCoordinate.latitude) ?? 0
    const column = longitudeIndex.get(point.gridCoordinate.longitude) ?? 0
    return row % latitudeStride === 0 && column % longitudeStride === 0
  })
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
  windField,
  windUnit,
  nowMs,
  onSelectStation,
}: WeatherMapProps) {
  const { locale, t } = useI18n()
  const containerRef = useRef<HTMLDivElement>(null)
  const compassRoseRef = useRef<HTMLSpanElement>(null)
  const handleRef = useRef<CesiumViewerHandle | null>(null)
  const stationByEntity = useRef(new Map<Entity, string>())
  const labelByMarker = useRef(new Map<Entity, Entity>())
  const markerEntitiesById = useRef(new Map<string, MarkerEntitySet>())
  const initialFrameComplete = useRef(false)
  const previousSiteId = useRef<SiteId | null>(null)
  const onSelectRef = useRef(onSelectStation)
  const [readyVersion, setReadyVersion] = useState(0)
  const [status, setStatus] = useState<CesiumViewerStatus | null>(null)
  const [mapError, setMapError] = useState<'webgl' | 'initialization' | null>(null)
  const [mapStyle, setMapStyle] = useState<WeatherMapStyle>('topographic')
  const [showWindArrows, setShowWindArrows] = useState(true)
  const [hiddenMarkerIds, setHiddenMarkerIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  const requestedMapStyleRef = useRef(mapStyle)
  requestedMapStyleRef.current = mapStyle
  const reducedMotion = useMemo(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  )
  const windFieldData =
    windField.status === 'available'
      ? windField.data
      : windField.status === 'loading'
        ? windField.previous
        : null
  const displayedWindPoints = useMemo(
    () => (windFieldData === null ? [] : selectWindPointsForMap(windFieldData.points)),
    [windFieldData],
  )

  useEffect(() => {
    onSelectRef.current = onSelectStation
  }, [onSelectStation])

  useEffect(() => {
    let cancelled = false
    setMapError(null)
    setStatus(null)
    const initialize = async () => {
      const container = containerRef.current
      if (container === null) return
      const initialMapStyle = requestedMapStyleRef.current
      let handle: CesiumViewerHandle
      try {
        handle = await createCesiumViewer(
          container,
          'weather',
          initialMapStyle,
          (nextStatus) => {
            if (!cancelled) setStatus(nextStatus)
          },
        )
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
      if (requestedMapStyleRef.current !== initialMapStyle) {
        try {
          await handle.setProviderPolicy(requestedMapStyleRef.current)
        } catch {
          if (!cancelled) setStatus({ ...handle.status, degradedReason: 'provider-error' })
        }
      }
      if (cancelled) {
        destroyCesiumViewer(handle)
        handleRef.current = null
        return
      }
      const updateCompass = () => {
        const headingDegrees = CesiumMath.toDegrees(handle.viewer.camera.heading)
        compassRoseRef.current?.style.setProperty('transform', `rotate(${-headingDegrees}deg)`)
      }
      handle.viewer.camera.percentageChanged = 0.01
      const removeCameraChanged = handle.viewer.camera.changed.addEventListener(updateCompass)
      updateCompass()
      const clickHandler = new ScreenSpaceEventHandler(handle.viewer.scene.canvas)
      clickHandler.setInputAction(
        (movement: { position: Cartesian2 }) => {
          const picked = handle.viewer.scene.pick(movement.position) as
            | { id?: unknown }
            | undefined
          const pickedEntity = picked?.id instanceof Entity ? picked.id : undefined
          const selectedLabel =
            pickedEntity === undefined ? undefined : labelByMarker.current.get(pickedEntity)
          const showSelected = selectedLabel !== undefined && !selectedLabel.show
          for (const label of labelByMarker.current.values()) label.show = false
          if (showSelected) selectedLabel.show = true
          if (pickedEntity !== undefined) {
            const stationId = stationByEntity.current.get(pickedEntity)
            if (stationId !== undefined) onSelectRef.current(stationId)
          }
          handle.viewer.scene.requestRender()
        },
        ScreenSpaceEventType.LEFT_CLICK,
      )
      const originalDestroy = handle.destroy
      handle.destroy = () => {
        removeCameraChanged()
        if (!clickHandler.isDestroyed()) clickHandler.destroy()
        originalDestroy()
      }
      setReadyVersion((version) => version + 1)
    }
    void initialize()
    return () => {
      cancelled = true
      stationByEntity.current.clear()
      labelByMarker.current.clear()
      destroyCesiumViewer(handleRef.current)
      handleRef.current = null
      initialFrameComplete.current = false
      previousSiteId.current = null
    }
  }, [])

  useEffect(() => {
    const handle = handleRef.current
    if (handle === null) return
    let active = true
    void handle.setProviderPolicy(mapStyle).catch(() => {
      if (active) setStatus({ ...handle.status, degradedReason: 'provider-error' })
    })
    return () => {
      active = false
    }
  }, [mapStyle])

  useEffect(() => {
    const viewer = handleRef.current?.viewer
    if (viewer === undefined) return
    viewer.entities.removeAll()
    stationByEntity.current.clear()
    labelByMarker.current.clear()
    markerEntitiesById.current.clear()
    const observationByStation = new Map(
      observations.map((observation) => [observation.stationId, observation]),
    )
    const framingPositions: Cartesian3[] = []

    for (const configuredSiteId of siteIds) {
      const site = sites[configuredSiteId]
      const position = Cartesian3.fromDegrees(site.longitude, site.latitude)
      framingPositions.push(position)
      const marker = viewer.entities.add({
        show: !hiddenMarkerIds.has(`site:${configuredSiteId}`),
        name: site.name[locale],
        position,
        point: {
          color: Color.fromCssColorString('#FFB454'),
          pixelSize: configuredSiteId === siteId ? 14 : 10,
          heightReference: HeightReference.CLAMP_TO_GROUND,
          outlineColor: Color.fromCssColorString('#0B1117'),
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      })
      const label = viewer.entities.add({
        name: site.name[locale],
        show: false,
        position,
        label: {
          text: site.name[locale],
          font: '700 15px system-ui',
          fillColor: Color.WHITE,
          showBackground: true,
          backgroundColor: Color.fromCssColorString('#0B1117').withAlpha(0.88),
          pixelOffset: new Cartesian2(0, -28),
          horizontalOrigin: HorizontalOrigin.CENTER,
          verticalOrigin: VerticalOrigin.BOTTOM,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      })
      labelByMarker.current.set(marker, label)
      markerEntitiesById.current.set(`site:${configuredSiteId}`, {
        visibleEntities: [marker],
        label,
      })
    }

    if (displayedWindPoints.length > 0 && showWindArrows) {
      for (const point of displayedWindPoints) {
        const position = Cartesian3.fromDegrees(
          point.gridCoordinate.longitude,
          point.gridCoordinate.latitude,
        )
        if (
          point.windFromDeg === null ||
          point.windSpeedMps === null ||
          point.windSpeedMps < 0.5
        ) {
          const missing =
            point.windSpeedMps === null ||
            (point.windFromDeg === null && point.windSpeedMps >= 0.5)
          viewer.entities.add({
            name: missing
              ? locale === 'de' ? 'Modellgitter: Wert fehlt' : 'Model grid: value missing'
              : locale === 'de' ? 'Modellgitter: windstill' : 'Model grid: calm',
            position,
            point: {
              color: Color.fromCssColorString(missing ? '#A8B1B8' : '#FF2DA8').withAlpha(0.95),
              pixelSize: 7,
              heightReference: HeightReference.CLAMP_TO_GROUND,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
          })
          continue
        }
        const arrowWidth = Math.min(34, 24 + point.windSpeedMps * 0.6)
        viewer.entities.add({
          name: locale === 'de' ? 'GeoSphere-Modellwind' : 'GeoSphere model wind',
          position,
          billboard: {
            image: modelWindImage,
            rotation: downwindBillboardRotation(point.windFromDeg),
            width: arrowWidth,
            height: arrowWidth * 1.85,
            horizontalOrigin: HorizontalOrigin.CENTER,
            verticalOrigin: VerticalOrigin.CENTER,
            heightReference: HeightReference.CLAMP_TO_GROUND,
            distanceDisplayCondition: new DistanceDisplayCondition(0, 100_000),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        })
      }
    }
    const areaGroups = addFlightAreaEntities(viewer, locale, siteId, hiddenMarkerIds)
    for (const group of areaGroups) {
      labelByMarker.current.set(group.marker, group.label)
      markerEntitiesById.current.set(group.id, {
        visibleEntities:
          group.shape === undefined ? [group.marker] : [group.marker, group.shape],
        label: group.label,
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
      const measuredFromDeg = observation.windFromDeg
      const hasMeasuredWind =
        measuredFromDeg !== null &&
        observation.meanWindMps !== null &&
        observation.meanWindMps >= 0.5
      const drawMeasuredWind = hasMeasuredWind && showWindArrows
      const marker = viewer.entities.add({
        show: !hiddenMarkerIds.has(`station:${station.id}`),
        name: station.name,
        position,
        point: {
          color,
          pixelSize: 7,
          heightReference: HeightReference.CLAMP_TO_GROUND,
          outlineColor: Color.fromCssColorString('#0B1117'),
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        billboard: drawMeasuredWind
          ? {
              image: measuredWindImage,
              color,
              rotation: downwindBillboardRotation(measuredFromDeg ?? 0),
              width: 32,
              height: 44,
              horizontalOrigin: HorizontalOrigin.CENTER,
              verticalOrigin: VerticalOrigin.CENTER,
              heightReference: HeightReference.CLAMP_TO_GROUND,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            }
          : undefined,
      })
      const label = viewer.entities.add({
        name: station.name,
        show: false,
        position,
        label: {
          text: badge,
          font: '700 13px system-ui',
          fillColor: Color.WHITE,
          showBackground: true,
          backgroundColor: Color.fromCssColorString('#0B1117').withAlpha(0.9),
          pixelOffset: new Cartesian2(0, drawMeasuredWind ? -36 : -22),
          distanceDisplayCondition: new DistanceDisplayCondition(0, 80_000),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      })
      stationByEntity.current.set(marker, station.id)
      labelByMarker.current.set(marker, label)
      markerEntitiesById.current.set(`station:${station.id}`, {
        visibleEntities: [marker],
        label,
      })
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
    showWindArrows,
    siteId,
    stations,
    displayedWindPoints,
    windUnit,
  ])

  useEffect(() => {
    for (const [id, entities] of markerEntitiesById.current) {
      const visible = !hiddenMarkerIds.has(id)
      for (const entity of entities.visibleEntities) entity.show = visible
      if (!visible) entities.label.show = false
    }
    handleRef.current?.viewer.scene.requestRender()
  }, [hiddenMarkerIds])

  const stationCount = observations.length
  const windFieldPointCount = windFieldData?.points.length ?? 0
  const displayedWindPointCount = displayedWindPoints.length
  let windFieldArrowCount = 0
  let windFieldCalmCount = 0
  for (const point of displayedWindPoints) {
    if (
      point.windFromDeg !== null &&
      point.windSpeedMps !== null &&
      point.windSpeedMps >= 0.5
    ) {
      windFieldArrowCount += 1
    } else if (point.windSpeedMps !== null && point.windSpeedMps < 0.5) {
      windFieldCalmCount += 1
    }
  }
  const windFieldMissingCount =
    displayedWindPointCount - windFieldArrowCount - windFieldCalmCount
  const summary =
    locale === 'de'
      ? `${stationCount} hervorgehobene Stationsmessungen und ${windFieldPointCount} Werte des regionalen Modellgitters. Modellwerte sind keine Interpolation der Stationen.`
      : `${stationCount} highlighted station measurements and ${windFieldPointCount} regional model-grid values. Model values are not interpolations of the stations.`
  const windFieldStatus =
    windFieldData !== null
      ? locale === 'de'
        ? `${windFieldPointCount}${displayedWindPointCount === windFieldPointCount ? ' Gitterpunkte:' : ` Gitterpunkte; Karte zeigt ${displayedWindPointCount} ausgedünnte Punkte:`} ${windFieldArrowCount} Pfeile, ${windFieldCalmCount} windstill, ${windFieldMissingCount} fehlend · gültig ${new Intl.DateTimeFormat('de', { dateStyle: 'short', timeStyle: 'short' }).format(windFieldData.validTimeMs)} · ${windFieldData.modelResolution}`
        : `${windFieldPointCount}${displayedWindPointCount === windFieldPointCount ? ' grid points:' : ` grid points; map displays ${displayedWindPointCount} sampled points:`} ${windFieldArrowCount} arrows, ${windFieldCalmCount} calm, ${windFieldMissingCount} missing · valid ${new Intl.DateTimeFormat('en', { dateStyle: 'short', timeStyle: 'short' }).format(windFieldData.validTimeMs)} · ${windFieldData.modelResolution}`
      : windField.status === 'unavailable'
        ? locale === 'de'
          ? 'Regionales Modellgitter nicht verfügbar; Stationsmessungen bleiben sichtbar.'
          : 'Regional model grid unavailable; station measurements remain visible.'
        : locale === 'de'
          ? 'Regionales Modellgitter wird geladen…'
          : 'Loading regional model grid…'

  const toggleMarker = (id: string) => {
    setHiddenMarkerIds((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const observedStationIds = new Set(
    observations.map((observation) => observation.stationId),
  )
  const markerGroups: MarkerToggleGroup[] = [
    {
      id: 'sites',
      label: t('siteMarkers'),
      items: siteIds.map((configuredSiteId) => ({
        id: `site:${configuredSiteId}`,
        label: sites[configuredSiteId].name[locale],
      })),
    },
    {
      id: 'stations',
      label: t('stationMarkers'),
      items: stations
        .filter((station) => observedStationIds.has(station.id))
        .map((station) => ({
          id: `station:${station.id}`,
          label: `${station.name} · ${station.id}`,
        })),
    },
    {
      id: 'takeoffs',
      label: t('takeoffMarkers'),
      items: flightAreas
        .filter((area) => area.siteId === siteId && area.kind === 'takeoff')
        .map((area) => ({ id: area.id, label: area.name[locale] })),
    },
    {
      id: 'landings',
      label: t('landingMarkers'),
      items: flightAreas
        .filter((area) => area.siteId === siteId && area.kind === 'landing')
        .map((area) => ({ id: area.id, label: area.name[locale] })),
    },
    {
      id: 'restrictions',
      label: t('restrictionMarkers'),
      items: siteRestrictions
        .filter((restriction) => restriction.siteId === siteId)
        .map((restriction) => ({
          id: restriction.id,
          label: restriction.name[locale],
        })),
    },
  ]

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
        <div className="map-style-control segmented" aria-label={locale === 'de' ? 'Kartenstil' : 'Map style'}>
          <button type="button" aria-pressed={mapStyle === 'topographic'} onClick={() => setMapStyle('topographic')}>
            {locale === 'de' ? 'Topografisch' : 'Topographic'}
          </button>
          <button type="button" aria-pressed={mapStyle === 'aviation'} onClick={() => setMapStyle('aviation')}>
            {locale === 'de' ? 'Luftfahrt' : 'Aviation'}
          </button>
        </div>
        <div
          className="map-compass"
          role="img"
          aria-label={locale === 'de' ? 'Kompass: Nadel zeigt Norden' : 'Compass: needle points north'}
        >
          <span ref={compassRoseRef} className="map-compass-rose" aria-hidden="true">
            <b>N</b>
            <i />
          </span>
        </div>
        {mapError === null ? (
          <MapOverlayControls
            markerGroups={markerGroups}
            hiddenMarkerIds={hiddenMarkerIds}
            onToggleMarker={toggleMarker}
            arrowsVisible={showWindArrows}
            onToggleArrows={() => setShowWindArrows((visible) => !visible)}
          />
        ) : null}
      </div>
        <div className="map-legend wind-map-legend">
          <strong>{locale === 'de' ? 'Windfeld' : 'Wind field'}</strong>
          <span className="wind-key-item">
            <img src={measuredWindImage} alt="" />
            {locale === 'de' ? 'Stationsmessung (Ring)' : 'Station measurement (ring)'}
          </span>
          <span className="wind-key-item">
            <img src={modelWindImage} alt="" />
            {locale === 'de' ? 'GeoSphere-Modellgitter (neonpink)' : 'GeoSphere model grid (neon pink)'}
          </span>
          <span>{locale === 'de' ? 'Die lange Spitze zeigt mit dem Wind; die Größe zeigt die Geschwindigkeit.' : 'The long tip points downwind; size indicates speed.'}</span>
          <span>{locale === 'de' ? 'Modellwerte sind eigenständige Flächenprognosen, keine Stationsinterpolation.' : 'Model values are independent gridded guidance, not station interpolation.'}</span>
          <span>{windFieldStatus}</span>
          {windFieldData !== null ? (
            <a href={windFieldData.sourceUrl} target="_blank" rel="noopener noreferrer">
              {locale === 'de' ? 'GeoSphere-Quelldaten' : 'GeoSphere source data'}
            </a>
          ) : null}
        </div>
      {status?.degradedReason !== null && status?.degradedReason !== undefined ? (
        <p className="map-status" role="status">{t('mapUnavailable')}</p>
      ) : null}
      <MapFeatureKey siteId={siteId} />
    </section>
  )
}
