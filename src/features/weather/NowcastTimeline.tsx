import type { WindUnit } from '../../domain/limits'
import type { SiteId } from '../../domain/sites'
import { comparisonFreshness, type LoadState, type SiteNowcastPoint } from '../../domain/weather'
import { useI18n } from '../../i18n/I18nProvider'
import { downwindArrowTransform, formatCoordinate, formatDirection, formatWind, resourceUnavailableText } from './formatWeather'

interface NowcastTimelineProps {
  state: LoadState<Record<SiteId, SiteNowcastPoint[]>>
  siteId: SiteId
  selectedTimeMs: number | null
  onSelectTime: (timestampMs: number) => void
  windUnit: WindUnit
  nowMs: number
}

function value(value: number | null, suffix: string): string {
  return value === null ? '—' : `${value.toFixed(1)} ${suffix}`
}

export function NowcastTimeline({
  state,
  siteId,
  selectedTimeMs,
  onSelectTime,
  windUnit,
  nowMs,
}: NowcastTimelineProps) {
  const { locale, formatVienna, t } = useI18n()
  const copy = locale === 'de'
    ? {
        loading: 'Kurzfristige Bodenprognose wird geladen…',
        unavailable: 'Kurzfristige Bodenprognose nicht verfügbar.',
        empty: 'Keine Nowcast-Zeitschritte zurückgegeben.',
        select: 'Nowcast-Zeit wählen',
        time: 'Gültig',
        direction: 'Herkunftsrichtung',
        mean: 'Mittelwind',
        gust: 'Böe',
        temperature: 'Temperatur',
        dew: 'Taupunkt',
        humidity: 'Feuchte',
        rain: 'Niederschlag',
        table: 'Alle 15-Minuten-Werte anzeigen',
      }
    : {
        loading: 'Loading short-term surface guidance…',
        unavailable: 'Short-term surface guidance is unavailable.',
        empty: 'No nowcast time steps were returned.',
        select: 'Choose nowcast time',
        time: 'Valid',
        direction: 'From-direction',
        mean: 'Average wind',
        gust: 'Gust',
        temperature: 'Temperature',
        dew: 'Dew point',
        humidity: 'Humidity',
        rain: 'Precipitation',
        table: 'Show every 15-minute value',
      }

  if (state.status === 'idle' || state.status === 'loading') {
    return <section className="card" aria-busy="true"><h2>{t('nowcast')}</h2><p>{copy.loading}</p></section>
  }
  if (state.status === 'unavailable') {
    return <section className="card"><h2>{t('nowcast')}</h2><p>{copy.unavailable}</p><p>{resourceUnavailableText(state.reason, locale)}</p></section>
  }
  const points = state.data[siteId]
  if (points.length === 0) return <section className="card"><h2>{t('nowcast')}</h2><p>{copy.empty}</p></section>
  const selected = points.find((point) => point.validTimeMs === selectedTimeMs) ?? points[0]!
  const freshness = comparisonFreshness('nowcast', selected.referenceTimeMs, nowMs)

  return (
    <section className="card model-card" aria-labelledby="nowcast-heading">
      <div className="card-heading-row">
        <div>
          <p className="eyebrow">GeoSphere nowcast-v1-15min-1km</p>
          <h2 id="nowcast-heading">{t('nowcast')}</h2>
        </div>
        <span className="freshness-badge">{t(freshness === 'fresh' ? 'fresh' : 'stale')}</span>
      </div>
      <p className="notice">{t('gridCaveat')}</p>
      <dl className="provenance-grid">
        <div><dt>{locale === 'de' ? 'Abfragepunkt' : 'Requested point'}</dt><dd>{formatCoordinate(selected.requestedCoordinate.latitude, selected.requestedCoordinate.longitude)}</dd></div>
        <div><dt>{locale === 'de' ? 'Gitterpunkt / Distanz' : 'Grid point / distance'}</dt><dd>{formatCoordinate(selected.gridCoordinate.latitude, selected.gridCoordinate.longitude)} · {(selected.gridDistanceM / 1000).toFixed(2)} km</dd></div>
        <div><dt>{locale === 'de' ? 'Auflösung' : 'Resolution'}</dt><dd>{selected.modelResolution}</dd></div>
        <div><dt>{t('referenceTime')}</dt><dd>{selected.referenceTimeMs === null ? '—' : formatVienna(selected.referenceTimeMs)}</dd></div>
        <div><dt>{t('fetched')}</dt><dd>{formatVienna(selected.fetchedAtMs)}</dd></div>
        <div><dt>{t('validTime')}</dt><dd>{formatVienna(selected.validTimeMs)}</dd></div>
      </dl>
      <label className="time-select">
        <span>{copy.select}</span>
        <select value={selected.validTimeMs} onChange={(event) => onSelectTime(Number(event.target.value))}>
          {points.map((point) => <option key={point.validTimeMs} value={point.validTimeMs}>{formatVienna(point.validTimeMs)}</option>)}
        </select>
      </label>
      <div className="selected-weather-values">
        <span className="large-wind-arrow" style={{ transform: downwindArrowTransform(selected.windFromDeg) }} aria-hidden="true">↑</span>
        <dl className="summary-grid compact-grid">
          <div><dt>{copy.direction}</dt><dd>{formatDirection(selected.windFromDeg, locale)}</dd></div>
          <div><dt>{copy.mean}</dt><dd>{formatWind(selected.meanWindMps, windUnit)}</dd></div>
          <div><dt>{copy.gust}</dt><dd>{formatWind(selected.gustMps, windUnit)}</dd></div>
          <div><dt>{copy.temperature}</dt><dd>{value(selected.temperatureC, '°C')}</dd></div>
          <div><dt>{copy.dew}</dt><dd>{value(selected.dewPointC, '°C')}</dd></div>
          <div><dt>{copy.humidity}</dt><dd>{value(selected.relativeHumidityPercent, '%')}</dd></div>
          <div><dt>{copy.rain}</dt><dd>{value(selected.precipitationMm, 'mm')}</dd></div>
        </dl>
      </div>
      <details>
        <summary>{copy.table}</summary>
        <div className="data-table-wrap"><table><thead><tr><th>{copy.time}</th><th>{copy.direction}</th><th>{copy.mean}</th><th>{copy.gust}</th><th>{copy.temperature}</th><th>{copy.dew}</th><th>{copy.humidity}</th><th>{copy.rain}</th></tr></thead><tbody>
          {points.map((point) => <tr key={point.validTimeMs}><td>{formatVienna(point.validTimeMs)}</td><td>{formatDirection(point.windFromDeg, locale)}</td><td>{formatWind(point.meanWindMps, windUnit)}</td><td>{formatWind(point.gustMps, windUnit)}</td><td>{value(point.temperatureC, '°C')}</td><td>{value(point.dewPointC, '°C')}</td><td>{value(point.relativeHumidityPercent, '%')}</td><td>{value(point.precipitationMm, 'mm')}</td></tr>)}
        </tbody></table></div>
      </details>
      <p className="attribution">{t('source')}: <a href={selected.sourceUrl} target="_blank" rel="noreferrer">GeoSphere Austria (CC BY 4.0)</a></p>
    </section>
  )
}
