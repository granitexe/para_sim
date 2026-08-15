import type { WindUnit } from '../../domain/limits'
import { sites, type SiteId } from '../../domain/sites'
import type { AloftWindPoint, LoadState } from '../../domain/weather'
import { useI18n } from '../../i18n/I18nProvider'
import { aloftRowsAboveSite } from '../../services/openMeteoClient'
import { downwindArrowTransform, formatAge, formatDirection, formatWind, resourceUnavailableText } from './formatWeather'

interface WindAloftProps {
  state: LoadState<Record<SiteId, AloftWindPoint[]>>
  siteId: SiteId
  selectedTimeMs: number | null
  onSelectTime: (timestampMs: number) => void
  windUnit: WindUnit
  nowMs: number
}

export function WindAloft({
  state,
  siteId,
  selectedTimeMs,
  onSelectTime,
  windUnit,
  nowMs,
}: WindAloftProps) {
  const { locale, formatVienna, t } = useI18n()
  const copy = locale === 'de'
    ? {
        loading: 'Höhenwind wird geladen…', unavailable: 'ICON-D2-Höhenwind nicht verfügbar.', empty: 'Keine Druckfläche liegt für diese Zeit mindestens 100 m über dem Gebiet.', select: 'Höhenwindzeit wählen', level: 'Druckfläche', height: 'Geopotentielle Höhe', direction: 'Herkunftsrichtung', speed: 'Geschwindigkeit', noGust: 'Keine Böe', derived: 'Open-Meteo kann bereitgestellte Modellvariablen ableiten oder interpolieren.', terrain: 'Druckflächen können Gelände schneiden, sind keine festen Höhen AGL und enthalten kein Böenfeld.',
      }
    : {
        loading: 'Loading winds aloft…', unavailable: 'ICON-D2 winds aloft are unavailable.', empty: 'No pressure surface is at least 100 m above the site at this time.', select: 'Choose aloft time', level: 'Pressure level', height: 'Geopotential height', direction: 'From-direction', speed: 'Speed', noGust: 'No gust field', derived: 'Open-Meteo may derive or interpolate exposed model variables.', terrain: 'Pressure surfaces can intersect terrain, are not fixed heights AGL, and have no gust field.',
      }
  if (state.status === 'idle' || state.status === 'loading') return <section className="card" aria-busy="true"><h2>{t('windAloft')}</h2><p>{copy.loading}</p></section>
  if (state.status === 'unavailable') return <section className="card"><h2>{t('windAloft')}</h2><p>{copy.unavailable}</p><p>{resourceUnavailableText(state.reason, locale)}</p></section>
  const allPoints = state.data[siteId]
  const times = [...new Set(allPoints.map((point) => point.validTimeMs))].sort((a, b) => a - b)
  if (times.length === 0) return <section className="card"><h2>{t('windAloft')}</h2><p>{copy.empty}</p></section>
  const selectedTime = times.includes(selectedTimeMs ?? Number.NaN) ? selectedTimeMs! : times[0]!
  const rows = aloftRowsAboveSite(
    allPoints.filter((point) => point.validTimeMs === selectedTime),
    sites[siteId].elevationM,
  ).sort((a, b) => b.pressureLevelHpa - a.pressureLevelHpa)
  const metadata = allPoints[0]!
  return (
    <section className="card model-card" aria-labelledby="aloft-heading">
      <div className="card-heading-row"><div><p className="eyebrow">DWD ICON-D2 via Open-Meteo</p><h2 id="aloft-heading">{t('windAloft')}</h2></div><span className="freshness-badge">{formatAge(metadata.fetchedAtMs, nowMs, locale)}</span></div>
      <p className="notice">{t('aloftCaveat')}</p>
      <p>{copy.terrain} {copy.derived}</p>
      <dl className="provenance-grid">
        <div><dt>{locale === 'de' ? 'Auflösung' : 'Resolution'}</dt><dd>{metadata.modelResolution}</dd></div>
        <div><dt>{t('referenceTime')}</dt><dd>{t('modelRunUnavailable')}</dd></div>
        <div><dt>{t('fetched')}</dt><dd>{formatVienna(metadata.fetchedAtMs)}</dd></div>
        <div><dt>{locale === 'de' ? 'Gitterdistanz' : 'Grid distance'}</dt><dd>{(metadata.gridDistanceM / 1000).toFixed(2)} km</dd></div>
      </dl>
      <label className="time-select"><span>{copy.select}</span><select value={selectedTime} onChange={(event) => onSelectTime(Number(event.target.value))}>{times.map((time) => <option key={time} value={time}>{formatVienna(time)}</option>)}</select></label>
      {rows.length === 0 ? <p>{copy.empty}</p> : (
        <div className="aloft-rows">
          {rows.map((point) => (
            <article key={point.pressureLevelHpa}>
              <div><strong>{point.pressureLevelHpa} hPa</strong><small>{copy.noGust}</small></div>
              <span className="large-wind-arrow" style={{ transform: downwindArrowTransform(point.windFromDeg) }} aria-hidden="true">↑</span>
              <dl><div><dt>{copy.height}</dt><dd>{point.geopotentialHeightM === null ? '—' : `${Math.round(point.geopotentialHeightM)} m AMSL`}</dd></div><div><dt>{copy.direction}</dt><dd>{formatDirection(point.windFromDeg, locale)}</dd></div><div><dt>{copy.speed}</dt><dd>{formatWind(point.windSpeedMps, windUnit)}</dd></div></dl>
            </article>
          ))}
        </div>
      )}
      <p className="attribution">{t('source')}: <a href={metadata.sourceUrl} target="_blank" rel="noreferrer">Open-Meteo non-commercial API</a> · <a href="https://www.dwd.de/EN/ourservices/nwp_forecast_data/nwp_forecast_data.html" target="_blank" rel="noreferrer">DWD ICON</a></p>
    </section>
  )
}
