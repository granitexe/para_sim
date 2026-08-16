import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ArcType,
  Cartesian2,
  Cartesian3,
  ClockRange,
  Color,
  CompositePositionProperty,
  HeightReference,
  JulianDate,
  LinearApproximation,
  Math as CesiumMath,
  PolylineOutlineMaterialProperty,
  Rectangle,
  SampledPositionProperty,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  TimeInterval,
  type Entity,
  type Viewer,
} from 'cesium'
import type { Flight } from '../../domain/flight'
import { useI18n } from '../../i18n/I18nProvider'
import {
  createCesiumViewer,
  destroyCesiumViewer,
  WebglUnavailableError,
  type CesiumViewerHandle,
  type CesiumViewerStatus,
} from '../../map/cesiumViewer'
import {
  addFlightAreaEntities,
  selectFlightAreaMarker,
  setFlightAreaMarkerVisibility,
  type FlightAreaEntityGroup,
} from '../../map/flightAreas'
import { MapOverlayControls, type MarkerToggleGroup } from '../../map/MapOverlayControls'
import { flightAreas, siteRestrictions } from '../../domain/sites'
import type { ProviderPolicy } from '../../map/providers'

interface FlightReplayMapProps {
  flight: Flight
  providerPolicy: ProviderPolicy
  onTimeChange: (timestampMs: number) => void
}

const speeds = [1, 2, 5, 10] as const

function formatElapsed(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function routeBounds(viewer: Viewer, positions: Cartesian3[], reducedMotion: boolean): void {
  if (positions.length === 0) return
  const rectangle = Rectangle.fromCartesianArray(positions)
  const center = Rectangle.center(rectangle)
  const halfWidth = Math.max(
    (Rectangle.computeWidth(rectangle) * 1.25) / 2,
    CesiumMath.toRadians(0.01),
  )
  const halfHeight = Math.max(
    (Rectangle.computeHeight(rectangle) * 1.25) / 2,
    CesiumMath.toRadians(0.01),
  )
  const destination = new Rectangle(
    CesiumMath.negativePiToPi(center.longitude - halfWidth),
    Math.max(-CesiumMath.PI_OVER_TWO, center.latitude - halfHeight),
    CesiumMath.negativePiToPi(center.longitude + halfWidth),
    Math.min(CesiumMath.PI_OVER_TWO, center.latitude + halfHeight),
  )
  viewer.trackedEntity = undefined
  if (reducedMotion) {
    viewer.camera.setView({ destination })
    viewer.scene.requestRender()
  } else {
    void viewer.camera.flyTo({ destination, duration: 0.6 })
  }
}

export function FlightReplayMap({
  flight,
  providerPolicy,
  onTimeChange,
}: FlightReplayMapProps) {
  const { locale, t } = useI18n()
  const firstTimestamp = flight.segments[0]!.points[0]!.timestampMs
  const finalSegment = flight.segments[flight.segments.length - 1]!
  const lastTimestamp = finalSegment.points[finalSegment.points.length - 1]!.timestampMs
  const [currentTimestamp, setCurrentTimestamp] = useState(firstTimestamp)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<(typeof speeds)[number]>(1)
  const [follow, setFollow] = useState(false)
  const [status, setStatus] = useState<CesiumViewerStatus | null>(null)
  const [mapError, setMapError] = useState<'webgl' | 'initialization' | null>(null)
  const [viewerReady, setViewerReady] = useState(false)
  const [hiddenMarkerIds, setHiddenMarkerIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  const containerRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<CesiumViewerHandle | null>(null)
  const markerRef = useRef<Entity | null>(null)
  const routePositionsRef = useRef<Cartesian3[]>([])
  const areaGroupsRef = useRef<FlightAreaEntityGroup[]>([])
  const currentTimestampRef = useRef(firstTimestamp)
  const followRef = useRef(follow)
  const playingRef = useRef(playing)
  const onTimeChangeRef = useRef(onTimeChange)
  const requestedProviderPolicyRef = useRef(providerPolicy)
  const hiddenMarkerIdsRef = useRef(hiddenMarkerIds)
  requestedProviderPolicyRef.current = providerPolicy
  hiddenMarkerIdsRef.current = hiddenMarkerIds
  const reducedMotion = useMemo(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  )

  useEffect(() => {
    onTimeChangeRef.current = onTimeChange
  }, [onTimeChange])
  useEffect(() => {
    followRef.current = follow
    const viewer = handleRef.current?.viewer
    if (viewer !== undefined) viewer.trackedEntity = follow ? markerRef.current ?? undefined : undefined
  }, [follow])
  useEffect(() => {
    playingRef.current = playing
    const viewer = handleRef.current?.viewer
    if (viewer !== undefined) viewer.clock.shouldAnimate = playing
  }, [playing])
  useLayoutEffect(() => {
    const handle = handleRef.current
    if (handle === null) return
    let active = true
    void handle.setProviderPolicy(providerPolicy).catch(() => {
      if (active) setStatus({ ...handle.status, degradedReason: 'provider-error' })
    })
    return () => {
      active = false
    }
  }, [providerPolicy])
  useEffect(() => {
    setFlightAreaMarkerVisibility(areaGroupsRef.current, hiddenMarkerIds)
    handleRef.current?.viewer.scene.requestRender()
  }, [hiddenMarkerIds])

  useEffect(() => {
    let cancelled = false
    setMapError(null)
    setStatus(null)
    setViewerReady(false)
    currentTimestampRef.current = Math.min(
      lastTimestamp,
      Math.max(firstTimestamp, currentTimestampRef.current),
    )

    const initialize = async () => {
      const container = containerRef.current
      if (container === null) return
      const initialProviderPolicy = requestedProviderPolicyRef.current
      let handle: CesiumViewerHandle
      try {
        handle = await createCesiumViewer(
          container,
          'flight',
          initialProviderPolicy,
          (nextStatus) => {
            if (!cancelled) setStatus(nextStatus)
          },
        )
      } catch (error) {
        if (cancelled) return
        setMapError(error instanceof WebglUnavailableError ? 'webgl' : 'initialization')
        return
      }
      if (cancelled) {
        destroyCesiumViewer(handle)
        return
      }
      handleRef.current = handle
      if (requestedProviderPolicyRef.current !== initialProviderPolicy) {
        try {
          await handle.setProviderPolicy(requestedProviderPolicyRef.current)
        } catch {
          if (!cancelled) setStatus({ ...handle.status, degradedReason: 'provider-error' })
        }
      }
      if (cancelled) {
        destroyCesiumViewer(handle)
        handleRef.current = null
        return
      }
      const viewer = handle.viewer
      const areaGroups = addFlightAreaEntities(
        viewer,
        locale,
        undefined,
        hiddenMarkerIdsRef.current,
      )
      areaGroupsRef.current = areaGroups
      const areaClickHandler = new ScreenSpaceEventHandler(viewer.scene.canvas)
      areaClickHandler.setInputAction(
        (movement: { position: Cartesian2 }) => {
          const picked = viewer.scene.pick(movement.position) as { id?: Entity } | undefined
          selectFlightAreaMarker(areaGroups, picked?.id)
          viewer.scene.requestRender()
        },
        ScreenSpaceEventType.LEFT_CLICK,
      )
      const allPositions: Cartesian3[] = []
      const composite = new CompositePositionProperty()
      const fullRouteMaterial = new PolylineOutlineMaterialProperty({
        color: Color.fromCssColorString('#F7FAFC').withAlpha(0.9),
        outlineColor: Color.fromCssColorString('#081117').withAlpha(0.95),
        outlineWidth: 2,
      })

      for (const segment of flight.renderSegments) {
        const positions: Cartesian3[] = []
        const sampled = new SampledPositionProperty()
        for (const point of segment.points) {
          const position = Cartesian3.fromDegrees(point.longitude, point.latitude)
          const time = JulianDate.fromDate(new Date(point.timestampMs))
          sampled.addSample(time, position)
          positions.push(position)
          allPositions.push(position)
        }
        sampled.setInterpolationOptions({
          interpolationAlgorithm: LinearApproximation,
          interpolationDegree: 1,
        })
        const start = JulianDate.fromDate(new Date(segment.points[0]!.timestampMs))
        const stop = JulianDate.fromDate(
          new Date(segment.points[segment.points.length - 1]!.timestampMs),
        )
        composite.intervals.addInterval(
          new TimeInterval({
            start,
            stop,
            isStartIncluded: true,
            isStopIncluded: true,
            data: sampled,
          }),
        )
        viewer.entities.add({
          polyline: {
            positions,
            width: 4,
            material: fullRouteMaterial,
            clampToGround: true,
            arcType: ArcType.GEODESIC,
          },
        })
      }

      const marker = viewer.entities.add({
        name: '2D flight position',
        position: composite,
        path: {
          material: new PolylineOutlineMaterialProperty({
            color: Color.fromCssColorString('#00E5FF'),
            outlineColor: Color.fromCssColorString('#071116'),
            outlineWidth: 2,
          }),
          width: 6,
          leadTime: 0,
          trailTime: Math.max(1, flight.durationMs / 1000),
          resolution: 1,
        },
        point: {
          color: Color.fromCssColorString('#FFE600'),
          pixelSize: 14,
          heightReference: HeightReference.CLAMP_TO_GROUND,
          outlineColor: Color.fromCssColorString('#071116'),
          outlineWidth: 3,
        },
      })
      markerRef.current = marker
      routePositionsRef.current = allPositions

      const start = JulianDate.fromDate(new Date(firstTimestamp))
      const stop = JulianDate.fromDate(new Date(lastTimestamp))
      viewer.clock.startTime = start.clone()
      viewer.clock.stopTime = stop.clone()
      viewer.clock.currentTime = JulianDate.fromDate(new Date(currentTimestampRef.current))
      viewer.clock.clockRange = ClockRange.CLAMPED
      viewer.clock.multiplier = speed
      viewer.clock.shouldAnimate = !reducedMotion && playingRef.current
      if (followRef.current) viewer.trackedEntity = marker
      routeBounds(viewer, allPositions, reducedMotion)

      let lastReactUpdate = Number.NEGATIVE_INFINITY
      const removeTick = viewer.clock.onTick.addEventListener(() => {
        const timestamp = Math.min(
          lastTimestamp,
          Math.max(firstTimestamp, JulianDate.toDate(viewer.clock.currentTime).getTime()),
        )
        const now = performance.now()
        const reachedEnd = timestamp >= lastTimestamp
        if (reachedEnd && viewer.clock.shouldAnimate) {
          viewer.clock.shouldAnimate = false
          playingRef.current = false
          setPlaying(false)
        }
        if (reachedEnd || now - lastReactUpdate >= 250) {
          lastReactUpdate = now
          currentTimestampRef.current = timestamp
          setCurrentTimestamp(timestamp)
          onTimeChangeRef.current(timestamp)
        }
      })
      const handleVisibility = () => {
        if (document.visibilityState !== 'visible' && viewer.clock.shouldAnimate) {
          viewer.clock.shouldAnimate = false
          playingRef.current = false
          setPlaying(false)
        }
      }
      document.addEventListener('visibilitychange', handleVisibility)
      setViewerReady(true)

      const originalDestroy = handle.destroy
      handle.destroy = () => {
        viewer.clock.shouldAnimate = false
        removeTick()
        areaClickHandler.destroy()
        document.removeEventListener('visibilitychange', handleVisibility)
        originalDestroy()
      }
    }

    void initialize()
    return () => {
      cancelled = true
      markerRef.current = null
      routePositionsRef.current = []
      areaGroupsRef.current = []
      destroyCesiumViewer(handleRef.current)
      handleRef.current = null
    }
  }, [firstTimestamp, flight, lastTimestamp, locale, reducedMotion])

  const scrub = (timestamp: number) => {
    const clamped = Math.min(lastTimestamp, Math.max(firstTimestamp, timestamp))
    const viewer = handleRef.current?.viewer
    if (viewer !== undefined) {
      viewer.clock.currentTime = JulianDate.fromDate(new Date(clamped))
      viewer.clock.shouldAnimate = false
      viewer.scene.requestRender()
    }
    playingRef.current = false
    setPlaying(false)
    currentTimestampRef.current = clamped
    setCurrentTimestamp(clamped)
    onTimeChangeRef.current(clamped)
  }

  const togglePlayback = () => {
    const viewer = handleRef.current?.viewer
    if (viewer === undefined) return
    if (!playingRef.current && currentTimestampRef.current >= lastTimestamp) {
      scrub(firstTimestamp)
    }
    const next = !playingRef.current
    playingRef.current = next
    viewer.clock.shouldAnimate = next
    setPlaying(next)
  }

  const changeSpeed = (value: number) => {
    const next = speeds.find((candidate) => candidate === value) ?? 1
    setSpeed(next)
    const viewer = handleRef.current?.viewer
    if (viewer !== undefined) viewer.clock.multiplier = next
  }

  const restart = () => scrub(firstTimestamp)
  const resetView = () => {
    const viewer = handleRef.current?.viewer
    if (viewer !== undefined) routeBounds(viewer, routePositionsRef.current, reducedMotion)
  }
  const toggleMarker = (id: string) => {
    setHiddenMarkerIds((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const markerGroups: MarkerToggleGroup[] = [
    {
      id: 'takeoffs',
      label: t('takeoffMarkers'),
      items: flightAreas
        .filter((area) => area.kind === 'takeoff')
        .map((area) => ({ id: area.id, label: area.name[locale] })),
    },
    {
      id: 'landings',
      label: t('landingMarkers'),
      items: flightAreas
        .filter((area) => area.kind === 'landing')
        .map((area) => ({ id: area.id, label: area.name[locale] })),
    },
    {
      id: 'restrictions',
      label: t('restrictionMarkers'),
      items: siteRestrictions.map((restriction) => ({
        id: restriction.id,
        label: restriction.name[locale],
      })),
    },
  ]
  const copy =
    locale === 'de'
      ? {
          heading: '2D-Flugwiedergabe',
          summary:
            'Draufsicht mit zeitlicher Flugspur. Aufgezeichnete Höhen bleiben in der Flugzusammenfassung, werden auf der Karte aber bewusst nicht als Höhe dargestellt. Lücken werden nicht überbrückt.',
          loading: '2D-Karte wird geladen…',
        }
      : {
          heading: '2D flight track replay',
          summary:
            'Top-down timed replay. Recorded altitude remains in the flight summary but is intentionally not drawn as map height. Gaps are never interpolated.',
          loading: 'Loading 2D map…',
        }

  return (
    <section className="replay-map" aria-labelledby="replay-map-heading">
      <div className="map-text-summary">
        <h2 id="replay-map-heading" className="sr-only">{copy.heading}</h2>
        <p className="sr-only">{copy.summary}</p>
      </div>
      <div className="map-panel">
        {mapError === null ? (
          <div
            ref={containerRef}
            className="cesium-container"
            role="region"
            aria-label={`${copy.heading}. ${copy.summary}`}
          />
        ) : (
          <div className="map-text-fallback" role="status">
            <h2>{copy.heading}</h2>
            <p>{mapError === 'webgl' ? t('webglUnavailable') : t('mapUnavailable')}</p>
            <p>{copy.summary}</p>
          </div>
        )}
        {status === null && mapError === null ? <p className="map-loading">{copy.loading}</p> : null}
        {mapError === null ? (
          <MapOverlayControls
            markerGroups={markerGroups}
            hiddenMarkerIds={hiddenMarkerIds}
            onToggleMarker={toggleMarker}
          />
        ) : null}
      </div>
      {status?.degradedReason !== null && status?.degradedReason !== undefined ? (
        <p className="map-status" role="status">{t('mapUnavailable')}</p>
      ) : null}
      <div className="replay-controls" aria-label={copy.heading}>
        <div className="control-row">
          <button type="button" onClick={togglePlayback} disabled={!viewerReady}>
            {playing ? t('pause') : t('play')}
          </button>
          <button type="button" onClick={restart} disabled={!viewerReady}>{t('restart')}</button>
          <label>
            <span>{t('playbackSpeed')}</span>
            <select
              value={speed}
              disabled={!viewerReady}
              onChange={(event) => changeSpeed(Number(event.target.value))}
            >
              {speeds.map((value) => <option key={value} value={value}>{value}×</option>)}
            </select>
          </label>
          <label className="checkbox-control">
            <input
              type="checkbox"
              checked={follow}
              onChange={(event) => setFollow(event.target.checked)}
            />
            <span>{t('followMarker')}</span>
          </label>
          <button type="button" onClick={resetView} disabled={!viewerReady}>{t('resetView')}</button>
        </div>
        <label className="scrubber">
          <span>{t('flightProgress')}</span>
          <input
            type="range"
            min={firstTimestamp}
            max={lastTimestamp}
            step={1000}
            value={currentTimestamp}
            disabled={!viewerReady}
            onChange={(event) => scrub(Number(event.target.value))}
          />
        </label>
        <p className="playback-time" aria-live="polite">
          {t('elapsed')}: {formatElapsed(currentTimestamp - firstTimestamp)} / {formatElapsed(lastTimestamp - firstTimestamp)} · {t('utcTime')} {new Date(currentTimestamp).toISOString().slice(11, 19)}
        </p>
      </div>
    </section>
  )
}
