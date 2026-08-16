import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import type { PreferencesV1 } from '../../domain/limits'
import { sites, siteIds, type SiteId } from '../../domain/sites'
import { useI18n } from '../../i18n/I18nProvider'
import { ForecastTimeline } from './ForecastTimeline'
import { LimitComparisons } from './LimitComparisons'
import { NowcastTimeline } from './NowcastTimeline'
import { SiteResources } from './SiteResources'
import { SettingsSheet } from './SettingsSheet'
import { StationSheet } from './StationSheet'
import { ThermalContext } from './ThermalContext'
import { useWeatherData } from './useWeatherData'
import { WindTimeline } from './WindTimeline'
import { WarningsPanel } from './WarningsPanel'
import { WindAloft } from './WindAloft'
import { resourceUnavailableText } from './formatWeather'

const LazyWeatherMap = lazy(() =>
  import('./WeatherMap').then((module) => ({ default: module.WeatherMap })),
)

interface WeatherPageProps {
  siteId: SiteId
  selectedStationId: string | null
  preferences: PreferencesV1
  onPreferencesChange: (preferences: PreferencesV1) => void
  onSiteChange: (siteId: SiteId) => void
  onStationChange: (stationId: string | null) => void
}

export function WeatherPage({
  siteId,
  selectedStationId,
  preferences,
  onPreferencesChange,
  onSiteChange,
  onStationChange,
}: WeatherPageProps) {
  const { locale, t } = useI18n()
  const [detailsExpanded, setDetailsExpanded] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [selectedNowcastTimeMs, setSelectedNowcastTimeMs] = useState<number | null>(null)
  const [selectedForecastTimeMs, setSelectedForecastTimeMs] = useState<number | null>(null)
  const [selectedAloftTimeMs, setSelectedAloftTimeMs] = useState<number | null>(null)
  const resources = useWeatherData({ selectedSiteId: siteId, selectedStationId, locale })
  const currentData =
    resources.current.status === 'available' ? resources.current.data : null
  const usableStationIds = useMemo(
    () => new Set(currentData?.observations.map((observation) => observation.stationId) ?? []),
    [currentData],
  )
  const usableStations = useMemo(
    () =>
      (currentData?.stations ?? [])
        .filter((station) => usableStationIds.has(station.id))
        .sort((a, b) => a.distanceToSitesM[siteId] - b.distanceToSitesM[siteId]),
    [currentData, siteId, usableStationIds],
  )

  useEffect(() => {
    if (resources.nowcast.status !== 'available') return
    const points = resources.nowcast.data[siteId]
    if (!points.some((point) => point.validTimeMs === selectedNowcastTimeMs)) {
      setSelectedNowcastTimeMs(points[0]?.validTimeMs ?? null)
    }
  }, [resources.nowcast, selectedNowcastTimeMs, siteId])

  useEffect(() => {
    if (resources.nwp.status !== 'available') return
    const points = resources.nwp.data[siteId]
    if (!points.some((point) => point.validTimeMs === selectedForecastTimeMs)) {
      setSelectedForecastTimeMs(points[0]?.validTimeMs ?? null)
    }
  }, [resources.nwp, selectedForecastTimeMs, siteId])

  useEffect(() => {
    if (resources.aloft.status !== 'available') return
    const times = new Set(resources.aloft.data[siteId].map((point) => point.validTimeMs))
    if (selectedAloftTimeMs === null || !times.has(selectedAloftTimeMs)) {
      setSelectedAloftTimeMs(times.values().next().value ?? null)
    }
  }, [resources.aloft, selectedAloftTimeMs, siteId])

  const selectedForecastPoint =
    resources.nwp.status === 'available'
      ? resources.nwp.data[siteId].find(
          (point) => point.validTimeMs === selectedForecastTimeMs,
        ) ?? null
      : null
  const selectedNowcastPoint =
    resources.nowcast.status === 'available'
      ? resources.nowcast.data[siteId].find(
          (point) => point.validTimeMs === selectedNowcastTimeMs,
        ) ?? null
      : null
  const windUnit = preferences.windUnit

  const chooseSite = (nextSiteId: SiteId) => {
    onSiteChange(nextSiteId)
    onStationChange(sites[nextSiteId].directStationId)
  }
  const cooldownSeconds = Math.max(
    0,
    Math.ceil((resources.refreshAvailableAtMs - resources.nowMs) / 1_000),
  )
  const mapStations = currentData?.stations ?? []
  const mapObservations = currentData?.observations ?? []
  const copy =
    locale === 'de'
      ? {
          regional: 'Benannte Regionalstationen',
          none: 'Keine verwendbaren Punktmessungen in 45 km verfügbar.',
          details: 'Wetterdetails',
          sourceStatus: 'Datenquellen werden unabhängig geladen; fehlende Quellen ersetzen keine vorhandenen Werte.',
        }
      : {
          regional: 'Named regional stations',
          none: 'No usable point observations are available within 45 km.',
          details: 'Weather details',
          sourceStatus: 'Sources load independently; a missing source never replaces available values.',
        }

  return (
    <div className="map-detail-layout weather-layout">
      <Suspense
        fallback={<div className="map-panel map-text-fallback" role="status">{locale === 'de' ? 'Wetterkarte wird geladen…' : 'Loading weather map…'}</div>}
      >
        <LazyWeatherMap
          siteId={siteId}
          stations={mapStations}
          observations={mapObservations}
          windUnit={windUnit}
          windField={resources.windField}
          nowMs={Math.floor(resources.nowMs / 60_000) * 60_000}
          onSelectStation={onStationChange}
        />
      </Suspense>
      <aside className={`detail-panel weather-details ${detailsExpanded ? '' : 'details-collapsed'}`} aria-label={copy.details}>
        <div className="weather-toolbar">
          <div className="segmented" aria-label={t('selectSite')}>
            {siteIds.map((candidate) => (
              <button
                key={candidate}
                type="button"
                aria-pressed={siteId === candidate}
                onClick={() => chooseSite(candidate)}
              >
                {t(candidate)}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void resources.refresh()}
            disabled={resources.refreshing || cooldownSeconds > 0}
            aria-describedby="refresh-status"
          >
            {resources.refreshing ? t('refreshing') : t('refresh')}
          </button>
          <button type="button" onClick={() => setSettingsOpen(true)}>{t('settings')}</button>
          <button
            type="button"
            className="details-toggle"
            aria-expanded={detailsExpanded}
            onClick={() => setDetailsExpanded((expanded) => !expanded)}
          >
            {detailsExpanded ? t('collapseDetails') : t('expandDetails')}
          </button>
        </div>
        <p id="refresh-status" className="muted" aria-live="polite">
          {cooldownSeconds > 0 ? t('refreshCooldown', { seconds: cooldownSeconds }) : copy.sourceStatus}
        </p>
        <p className="decision-aid-persistent">{t('decisionAid')}</p>

        {detailsExpanded ? (
          <div className="card-stack">
            <header className="weather-title-block">
              <p className="eyebrow">{t('weatherTab')}</p>
              <h1>{sites[siteId].name[locale]}</h1>
            </header>
            <WarningsPanel
              official={resources.officialWarnings}
              thunderstorm={resources.thunderstorm}
              nowMs={resources.nowMs}
            />
            {siteId === 'gelderkogel' ? <p className="notice no-station-notice">{t('noDirectStation')}</p> : null}
            <section className="card station-picker" aria-labelledby="regional-stations-heading">
              <h2 id="regional-stations-heading">{copy.regional}</h2>
              {resources.current.status === 'unavailable' ? (
                <p role="status">{resourceUnavailableText(resources.current.reason, locale)}</p>
              ) : usableStations.length === 0 ? (
                <p>{resources.current.status === 'loading' ? t('refreshing') : copy.none}</p>
              ) : (
                <div className="station-button-list">
                  {usableStations.map((station) => (
                    <button
                      key={station.id}
                      type="button"
                      aria-pressed={selectedStationId === station.id}
                      onClick={() => onStationChange(station.id)}
                    >
                      <span>{station.name}</span>
                      <small>{station.id} · {(station.distanceToSitesM[siteId] / 1000).toFixed(1)} km</small>
                    </button>
                  ))}
                </div>
              )}
            </section>
            <StationSheet
              siteId={siteId}
              selectedStationId={selectedStationId}
              current={resources.current}
              windUnit={windUnit}
              nowMs={resources.nowMs}
            />
            <WindTimeline history={resources.history} windUnit={windUnit} />
            <NowcastTimeline
              state={resources.nowcast}
              siteId={siteId}
              selectedTimeMs={selectedNowcastTimeMs}
              onSelectTime={setSelectedNowcastTimeMs}
              windUnit={windUnit}
              nowMs={resources.nowMs}
            />
            <ForecastTimeline
              state={resources.nwp}
              siteId={siteId}
              selectedTimeMs={selectedForecastTimeMs}
              onSelectTime={setSelectedForecastTimeMs}
              windUnit={windUnit}
              nowMs={resources.nowMs}
            />
            <LimitComparisons
              siteId={siteId}
              limits={preferences.limits[siteId]}
              windUnit={windUnit}
              current={resources.current}
              nowcastPoint={selectedNowcastPoint}
              forecastPoint={selectedForecastPoint}
              nowMs={resources.nowMs}
            />
            <WindAloft
              state={resources.aloft}
              siteId={siteId}
              selectedTimeMs={selectedAloftTimeMs}
              onSelectTime={setSelectedAloftTimeMs}
              windUnit={windUnit}
              nowMs={resources.nowMs}
            />
            <ThermalContext point={selectedForecastPoint} />
            <SiteResources siteId={siteId} />
          </div>
        ) : null}
      </aside>
      {settingsOpen ? (
        <SettingsSheet
          preferences={preferences}
          onChange={onPreferencesChange}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
    </div>
  )
}
