import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { windFromMps, type WindUnit } from '../../domain/limits'
import type { LoadState, StationHistoryPoint } from '../../domain/weather'
import { useI18n } from '../../i18n/I18nProvider'
import { downwindArrowTransform, formatDirection, formatWind, resourceUnavailableText, windUnitLabel } from './formatWeather'

interface WindTimelineProps {
  history: LoadState<StationHistoryPoint[]>
  windUnit: WindUnit
}

export function WindTimeline({ history, windUnit }: WindTimelineProps) {
  const { locale, formatVienna, t } = useI18n()
  const copy =
    locale === 'de'
      ? {
          heading: '24-Stunden-Stationsverlauf',
          loading: 'Stationsverlauf wird geladen…',
          unavailable: 'Stationsverlauf nicht verfügbar.',
          empty: 'Für diese Station wurde kein Verlauf zurückgegeben.',
          chart: 'Linien für Mittelwind und Böe; Lücken werden nicht verbunden.',
          mean: 'Mittel',
          gust: 'Böe',
          direction: 'Stündliche Herkunftsrichtung',
          table: 'Datentabelle anzeigen',
          time: 'Zeit',
          temperature: 'Temperatur',
        }
      : {
          heading: '24-hour station history',
          loading: 'Loading station history…',
          unavailable: 'Station history is unavailable.',
          empty: 'No history was returned for this station.',
          chart: 'Average and gust lines; missing values are not connected.',
          mean: 'Average',
          gust: 'Gust',
          direction: 'Hourly from-direction',
          table: 'Show data table',
          time: 'Time',
          temperature: 'Temperature',
        }

  if (history.status === 'idle') return null
  if (history.status === 'loading') {
    return <section className="card" aria-busy="true"><h2>{copy.heading}</h2><p>{copy.loading}</p></section>
  }
  if (history.status === 'unavailable') {
    return <section className="card"><h2>{copy.heading}</h2><p>{copy.unavailable}</p><p>{resourceUnavailableText(history.reason, locale)}</p></section>
  }
  if (history.data.length === 0) {
    return <section className="card"><h2>{copy.heading}</h2><p>{copy.empty}</p></section>
  }

  const chartData = history.data.map((point) => ({
    timestamp: point.validTimeMs,
    mean: point.meanWindMps === null ? null : windFromMps(point.meanWindMps, windUnit),
    gust: point.gustMps === null ? null : windFromMps(point.gustMps, windUnit),
  }))
  const hourlyDirections = history.data.filter((point, index, points) => {
    const date = new Date(point.validTimeMs)
    return date.getUTCMinutes() === 0 || index === 0 || index === points.length - 1
  })

  return (
    <section className="card" aria-labelledby="wind-history-heading">
      <h2 id="wind-history-heading">{copy.heading}</h2>
      <p className="muted">{copy.chart}</p>
      <div className="chart" role="img" aria-label={copy.chart}>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={chartData} accessibilityLayer={false}>
            <CartesianGrid stroke="#31404d" strokeDasharray="3 3" />
            <XAxis
              dataKey="timestamp"
              type="number"
              domain={['dataMin', 'dataMax']}
              tickFormatter={(value: number) => new Intl.DateTimeFormat(locale === 'de' ? 'de-AT' : 'en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Vienna' }).format(value)}
              stroke="#aab8c3"
            />
            <YAxis unit={` ${windUnitLabel(windUnit)}`} stroke="#aab8c3" width={68} />
            <Tooltip
              labelFormatter={(value) => formatVienna(Number(value))}
              formatter={(value, name) => [`${Number(value).toFixed(1)} ${windUnitLabel(windUnit)}`, name === 'mean' ? copy.mean : copy.gust]}
              contentStyle={{ background: '#131c24', border: '1px solid #31404d' }}
            />
            <Legend formatter={(value) => value === 'mean' ? copy.mean : copy.gust} />
            <Line type="linear" dataKey="mean" stroke="#6ED5E6" dot={false} connectNulls={false} strokeWidth={2} />
            <Line type="linear" dataKey="gust" stroke="#FFB454" dot={false} connectNulls={false} strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="direction-strip" aria-label={copy.direction}>
        <strong>{copy.direction}</strong>
        <div role="region" tabIndex={0} aria-label={copy.direction}>
          {hourlyDirections.map((point) => (
            <span key={point.validTimeMs} title={`${formatVienna(point.validTimeMs)} · ${formatDirection(point.windFromDeg, locale)}`}>
              <span
                className="wind-arrow"
                style={{ transform: downwindArrowTransform(point.windFromDeg) }}
                aria-hidden="true"
              >↑</span>
              <small>{new Intl.DateTimeFormat(locale === 'de' ? 'de-AT' : 'en-GB', { hour: '2-digit', timeZone: 'Europe/Vienna' }).format(point.validTimeMs)}</small>
            </span>
          ))}
        </div>
      </div>
      <details>
        <summary>{copy.table}</summary>
        <div className="data-table-wrap" tabIndex={0}><table>
          <thead><tr><th>{copy.time}</th><th>{copy.direction}</th><th>{copy.mean}</th><th>{copy.gust}</th><th>{copy.temperature}</th></tr></thead>
          <tbody>
            {history.data.map((point) => (
              <tr key={point.validTimeMs}>
                <td>{formatVienna(point.validTimeMs)}</td>
                <td>{formatDirection(point.windFromDeg, locale)}</td>
                <td>{formatWind(point.meanWindMps, windUnit)}</td>
                <td>{formatWind(point.gustMps, windUnit)}</td>
                <td>{point.temperatureC === null ? '—' : `${point.temperatureC.toFixed(1)} °C`}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </details>
      <p className="attribution">{t('source')}: <a href={history.data[0]!.sourceUrl} target="_blank" rel="noreferrer">GeoSphere Austria TAWES (CC BY 4.0; source m/s)</a></p>
    </section>
  )
}
