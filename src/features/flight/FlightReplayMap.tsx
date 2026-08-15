import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArcType,
  BoundingSphere,
  Cartesian3,
  ClockRange,
  Color,
  CompositePositionProperty,
  HeadingPitchRange,
  HeightReference,
  JulianDate,
  LinearApproximation,
  Math as CesiumMath,
  Matrix4,
  SampledPositionProperty,
  TimeInterval,
  type Entity,
  type Viewer,
} from 'cesium'
import { replayAltitudeSource, selectedAltitudeM, type Flight } from '../../domain/flight'
import { useI18n } from '../../i18n/I18nProvider'
import {
  createCesiumViewer,
  destroyCesiumViewer,
  WebglUnavailableError,
  type CesiumViewerHandle,
  type CesiumViewerStatus,
} from '../../map/cesiumViewer'
import { addFlightAreaEntities } from '../../map/flightAreas'
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
  const sphere = BoundingSphere.fromPoints(positions)
  const offset = new HeadingPitchRange(
    0,
    CesiumMath.toRadians(-42),
    Math.max(sphere.radius * 2.8, 1_200),
  )
  viewer.trackedEntity = undefined
  if (reducedMotion) {
    viewer.camera.viewBoundingSphere(sphere, offset)
    viewer.camera.lookAtTransform(Matrix4.IDENTITY)
    viewer.scene.requestRender()
  } else {
    void viewer.camera.flyToBoundingSphere(sphere, { duration: 0.8, offset })
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
  const containerRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<CesiumViewerHandle | null>(null)
  const markerRef = useRef<Entity | null>(null)
  const routePositionsRef = useRef<Cartesian3[]>([])
  const currentTimestampRef = useRef(firstTimestamp)
  const followRef = useRef(follow)
  const playingRef = useRef(playing)
  const onTimeChangeRef = useRef(onTimeChange)
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

  useEffect(() => {
    let cancelled = false
    setMapError(null)
    setStatus(null)
    currentTimestampRef.current = Math.min(
      lastTimestamp,
      Math.max(firstTimestamp, currentTimestampRef.current),
    )

    const initialize = async () => {
      const container = containerRef.current
      if (container === null) return
      let handle: CesiumViewerHandle
      try {
        handle = await createCesiumViewer(container, 'flight', providerPolicy, (nextStatus) => {
          if (!cancelled) setStatus(nextStatus)
        })
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
      const viewer = handle.viewer
      addFlightAreaEntities(viewer, locale)
      const source = replayAltitudeSource(flight)
      const allPositions: Cartesian3[] = []
      const composite = new CompositePositionProperty()
      const fullRouteMaterial = Color.fromCssColorString('#B7C4CF').withAlpha(0.35)

      for (const segment of flight.renderSegments) {
        const positions: Cartesian3[] = []
        const sampled = new SampledPositionProperty()
        for (const point of segment.points) {
          const altitude = selectedAltitudeM(point, source)
          const position = Cartesian3.fromDegrees(
            point.longitude,
            point.latitude,
            altitude ?? 0,
          )
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
            width: 2,
            material: fullRouteMaterial,
            clampToGround: source === 'none',
            arcType: ArcType.GEODESIC,
          },
        })
      }

      const marker = viewer.entities.add({
        name: source === 'none' ? '2D terrain-draped flight position' : 'Source-altitude flight position',
        position: composite,
        path: {
          material: Color.fromCssColorString('#4DD0A8'),
          width: 5,
          leadTime: 0,
          trailTime: Math.max(1, flight.durationMs / 1000),
          resolution: 1,
        },
        point: {
          color: Color.fromCssColorString('#FFB454'),
          pixelSize: 12,
          heightReference:
            source === 'none' ? HeightReference.CLAMP_TO_GROUND : HeightReference.NONE,
          outlineColor: Color.fromCssColorString('#0B1117'),
          outlineWidth: 2,
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

      const originalDestroy = handle.destroy
      handle.destroy = () => {
        viewer.clock.shouldAnimate = false
        removeTick()
        document.removeEventListener('visibilitychange', handleVisibility)
        originalDestroy()
      }
    }

    void initialize()
    return () => {
      cancelled = true
      markerRef.current = null
      routePositionsRef.current = []
      destroyCesiumViewer(handleRef.current)
      handleRef.current = null
    }
  }, [firstTimestamp, flight, lastTimestamp, locale, providerPolicy, reducedMotion])

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
  const source = replayAltitudeSource(flight)
  const copy =
    locale === 'de'
      ? {
          heading: source === 'none' ? '2D-Flugspur am Gelände' : '3D-Flugspur mit Quellhöhe',
          summary:
            source === 'none'
              ? 'Zeitliche Wiedergabe auf einer am Gelände anliegenden 2D-Spur. Höhe und Vario sind nicht verfügbar.'
              : 'Quellhöhe wird ohne berechnetes AGL über dem Gelände dargestellt. Lücken werden nicht überbrückt.',
          loading: '3D-Karte wird geladen…',
        }
      : {
          heading: source === 'none' ? '2D terrain-draped flight track' : '3D source-altitude flight track',
          summary:
            source === 'none'
              ? 'Timed replay on a 2D terrain-draped track. Altitude and vario are unavailable.'
              : 'Source altitude is shown without calculated AGL. Gaps are never interpolated.',
          loading: 'Loading 3D map…',
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
      </div>
      {status?.degradedReason !== null && status?.degradedReason !== undefined ? (
        <p className="map-status" role="status">{t('mapUnavailable')}</p>
      ) : null}
      <div className="replay-controls" aria-label={copy.heading}>
        <div className="control-row">
          <button type="button" onClick={togglePlayback} disabled={handleRef.current === null}>
            {playing ? t('pause') : t('play')}
          </button>
          <button type="button" onClick={restart}>{t('restart')}</button>
          <label>
            <span>{t('playbackSpeed')}</span>
            <select value={speed} onChange={(event) => changeSpeed(Number(event.target.value))}>
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
          <button type="button" onClick={resetView}>{t('resetView')}</button>
        </div>
        <label className="scrubber">
          <span>{t('flightProgress')}</span>
          <input
            type="range"
            min={firstTimestamp}
            max={lastTimestamp}
            step={1000}
            value={currentTimestamp}
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
