import type { WindUnit } from '../../domain/limits'
import { sites, type SiteId } from '../../domain/sites'
import type { LoadState } from '../../domain/weather'
import type { StationCurrentResult } from '../../services/geosphereClient'
import { useI18n } from '../../i18n/I18nProvider'
import { formatAge, formatDirection, formatWind, resourceUnavailableText } from './formatWeather'

interface StationSheetProps {
  siteId: SiteId
  selectedStationId: string | null
  current: LoadState<StationCurrentResult>
  windUnit: WindUnit
  nowMs: number
}

function numberOrDash(value: number | null, suffix: string, digits = 1): string {
  return value === null ? '—' : `${value.toFixed(digits)} ${suffix}`
}

export function StationSheet({
  siteId,
  selectedStationId,
  current,
  windUnit,
  nowMs,
}: StationSheetProps) {
  const { locale, formatVienna, t } = useI18n()
  const copy =
    locale === 'de'
      ? {
          heading: 'Stationsdetails',
          loading: 'Stationsmessungen werden geladen…',
          choose: 'Wähle eine benannte Regionalstation auf der Karte oder in der Liste.',
          unavailable: 'Stationsmessungen sind derzeit nicht verfügbar.',
          direct: 'Direkte Station für Schöckl',
          regional: 'Nur regionaler Punktkontext',
          coordinates: 'Koordinaten',
          elevation: 'Stationshöhe',
          distance: 'Entfernung zum Gebiet',
          difference: 'Höhendifferenz zum Gebiet',
          observed: 'Messzeit / Alter',
          average: 'FFAM Mittelwind',
          gust: 'FFX Böe',
          direction: 'DD Herkunftsrichtung',
          gustDirection: 'DDX Böenrichtung',
          temperature: 'Temperatur',
          dewPoint: 'Taupunkt',
          humidity: 'Relative Feuchte',
          pressure: 'Stationsdruck',
          rain: 'Niederschlag in 10 Minuten',
          fetched: 'Abrufstatus',
          caveat: 'Diese Punktmessung wird weder räumlich interpoliert noch auf Starthöhe umgerechnet.',
          warnings: 'Quelldatenhinweise',
        }
      : {
          heading: 'Station details',
          loading: 'Loading station observations…',
          choose: 'Choose a named regional station on the map or in the list.',
          unavailable: 'Station observations are currently unavailable.',
          direct: 'Direct Schöckl station',
          regional: 'Regional point context only',
          coordinates: 'Coordinates',
          elevation: 'Station elevation',
          distance: 'Distance to site',
          difference: 'Elevation difference to site',
          observed: 'Observed / age',
          average: 'FFAM average wind',
          gust: 'FFX gust',
          direction: 'DD from-direction',
          gustDirection: 'DDX gust direction',
          temperature: 'Temperature',
          dewPoint: 'Dew point',
          humidity: 'Relative humidity',
          pressure: 'Station pressure',
          rain: 'Ten-minute precipitation',
          fetched: 'Fetch status',
          caveat: 'This point observation is neither spatially interpolated nor adjusted to launch elevation.',
          warnings: 'Source-data notices',
        }

  if (current.status === 'idle' || current.status === 'loading') {
    return <section className="card" aria-busy="true"><h2>{copy.heading}</h2><p>{copy.loading}</p></section>
  }
  if (current.status === 'unavailable') {
    return (
      <section className="card error-card" role="status">
        <h2>{copy.heading}</h2>
        <p>{copy.unavailable}</p>
        <p>{resourceUnavailableText(current.reason, locale)}</p>
      </section>
    )
  }
  if (selectedStationId === null) {
    return <section className="card"><h2>{copy.heading}</h2><p>{copy.choose}</p></section>
  }

  const station = current.data.stations.find((candidate) => candidate.id === selectedStationId)
  const observation = current.data.observations.find(
    (candidate) => candidate.stationId === selectedStationId,
  )
  if (station === undefined || observation === undefined) {
    return <section className="card"><h2>{copy.heading}</h2><p>{copy.choose}</p></section>
  }

  const site = sites[siteId]
  const distanceM = station.distanceToSitesM[siteId]
  const elevationDifference =
    station.elevationM === null ? null : station.elevationM - site.elevationM
  const freshness = nowMs - observation.observationTimeMs <= 20 * 60 * 1_000
  return (
    <section className="card station-sheet" aria-labelledby="station-sheet-heading">
      <div className="card-heading-row">
        <div>
          <p className="eyebrow">{site.directStationId === station.id ? copy.direct : copy.regional}</p>
          <h2 id="station-sheet-heading">{station.name} · {station.id}</h2>
        </div>
        <span className="freshness-badge">{freshness ? t('fresh') : t('stale')}</span>
      </div>
      <p className="notice">{copy.caveat}</p>
      <dl className="summary-grid compact-grid">
        <div><dt>{copy.coordinates}</dt><dd>{station.coordinate.latitude.toFixed(5)}, {station.coordinate.longitude.toFixed(5)}</dd></div>
        <div><dt>{copy.elevation}</dt><dd>{numberOrDash(station.elevationM, 'm', 0)}</dd></div>
        <div><dt>{copy.distance}</dt><dd>{(distanceM / 1000).toFixed(1)} km</dd></div>
        <div><dt>{copy.difference}</dt><dd>{elevationDifference === null ? '—' : `${elevationDifference > 0 ? '+' : ''}${Math.round(elevationDifference)} m`}</dd></div>
        <div><dt>{copy.observed}</dt><dd>{formatVienna(observation.observationTimeMs)} · {formatAge(observation.observationTimeMs, nowMs, locale)}</dd></div>
        <div><dt>{copy.average}</dt><dd>{formatWind(observation.meanWindMps, windUnit)}</dd></div>
        <div><dt>{copy.gust}</dt><dd>{formatWind(observation.gustMps, windUnit)}</dd></div>
        <div><dt>{copy.direction}</dt><dd>{formatDirection(observation.windFromDeg, locale)}</dd></div>
        <div><dt>{copy.gustDirection}</dt><dd>{formatDirection(observation.gustWindFromDeg, locale)}</dd></div>
        <div><dt>{copy.temperature}</dt><dd>{numberOrDash(observation.temperatureC, '°C')}</dd></div>
        <div><dt>{copy.dewPoint}</dt><dd>{numberOrDash(observation.dewPointC, '°C')}</dd></div>
        <div><dt>{copy.humidity}</dt><dd>{numberOrDash(observation.relativeHumidityPercent, '%', 0)}</dd></div>
        <div><dt>{copy.pressure}</dt><dd>{numberOrDash(observation.stationPressureHpa, 'hPa')}</dd></div>
        <div><dt>{copy.rain}</dt><dd>{numberOrDash(observation.precipitation10MinMm, 'mm')}</dd></div>
        <div><dt>{copy.fetched}</dt><dd>{formatVienna(observation.fetchedAtMs)} · {formatAge(observation.fetchedAtMs, nowMs, locale)}</dd></div>
      </dl>
      {observation.dataWarnings.length > 0 ? (
        <details><summary>{copy.warnings}</summary><ul>{observation.dataWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></details>
      ) : null}
      <p className="attribution">
        {t('source')}: <a href={observation.sourceUrl} target="_blank" rel="noreferrer">GeoSphere Austria TAWES (CC BY 4.0)</a>
      </p>
    </section>
  )
}
