import {
  compareWindToLimits,
  germanWindSector,
  type LimitComparison,
  type SiteLimits,
  type WindUnit,
} from '../../domain/limits'
import { sites, type SiteId } from '../../domain/sites'
import {
  comparisonFreshness,
  type LoadState,
  type SiteForecastPoint,
  type SiteNowcastPoint,
} from '../../domain/weather'
import type { StationCurrentResult } from '../../services/geosphereClient'
import { useI18n } from '../../i18n/I18nProvider'
import { formatDirection, formatWind } from './formatWeather'

interface LimitComparisonsProps {
  siteId: SiteId
  limits: SiteLimits
  windUnit: WindUnit
  current: LoadState<StationCurrentResult>
  nowcastPoint: SiteNowcastPoint | null
  forecastPoint: SiteForecastPoint | null
  nowMs: number
}

interface ComparisonGroup {
  key: string
  title: string
  sourceKind: string
  timestampMs: number
  comparisons: LimitComparison[]
  averageMps: number | null
  gustMps: number | null
  fromDegrees: number | null
}

export function LimitComparisons({
  siteId,
  limits,
  windUnit,
  current,
  nowcastPoint,
  forecastPoint,
  nowMs,
}: LimitComparisonsProps) {
  const { locale, formatVienna, t } = useI18n()
  const copy = locale === 'de'
    ? {
        heading: 'Vergleich mit deinen Grenzen', direct: 'Schöckl Direktmessung · Station 11241', nowcast: 'GeoSphere Nowcast · Modell', nwp: 'GeoSphere NWP · Modell', average: 'Mittelwind', gust: 'Böe', direction: 'Herkunftssektor', value: 'Wert', entered: 'Eingetragene Grenze', result: 'Vergleich', count: 'Überschritten/außerhalb in dieser Quelle', none: 'Für diese Quelle ist kein vergleichbarer Wert verfügbar.', statuses: { 'at-or-under-entered-limit': 'Auf oder unter eingetragener Grenze', 'over-entered-limit': 'Über eingetragener Grenze', 'inside-selected-sector': 'Im ausgewählten Sektor', 'outside-selected-sector': 'Außerhalb ausgewählter Sektoren', 'not-evaluated': 'Nicht bewertet' } as const,
      }
    : {
        heading: 'Comparison with your limits', direct: 'Schöckl direct observation · station 11241', nowcast: 'GeoSphere nowcast · model', nwp: 'GeoSphere NWP · model', average: 'Average wind', gust: 'Gust', direction: 'From-sector', value: 'Value', entered: 'Entered limit', result: 'Comparison', count: 'Exceeded/outside in this source', none: 'No comparable value is available for this source.', statuses: { 'at-or-under-entered-limit': 'At or under entered limit', 'over-entered-limit': 'Over entered limit', 'inside-selected-sector': 'Inside selected sector', 'outside-selected-sector': 'Outside selected sectors', 'not-evaluated': 'Not evaluated' } as const,
      }
  const groups: ComparisonGroup[] = []
  if (siteId === 'schoeckl' && current.status === 'available') {
    const observation = current.data.observations.find(
      (candidate) => candidate.stationId === sites.schoeckl.directStationId,
    )
    if (observation !== undefined) {
      groups.push({
        key: 'observation',
        title: copy.direct,
        sourceKind: t('observation'),
        timestampMs: observation.observationTimeMs,
        averageMps: observation.meanWindMps,
        gustMps: observation.gustMps,
        fromDegrees: observation.windFromDeg,
        comparisons: compareWindToLimits(
          {
            averageMps: observation.meanWindMps,
            gustMps: observation.gustMps,
            fromDegrees: observation.windFromDeg,
          },
          limits,
          comparisonFreshness('observation', observation.observationTimeMs, nowMs),
        ),
      })
    }
  }
  if (nowcastPoint !== null) {
    groups.push({
      key: 'nowcast', title: copy.nowcast, sourceKind: t('model'), timestampMs: nowcastPoint.validTimeMs,
      averageMps: nowcastPoint.meanWindMps, gustMps: nowcastPoint.gustMps, fromDegrees: nowcastPoint.windFromDeg,
      comparisons: compareWindToLimits({ averageMps: nowcastPoint.meanWindMps, gustMps: nowcastPoint.gustMps, fromDegrees: nowcastPoint.windFromDeg }, limits, comparisonFreshness('nowcast', nowcastPoint.referenceTimeMs, nowMs)),
    })
  }
  if (forecastPoint !== null) {
    groups.push({
      key: 'nwp', title: copy.nwp, sourceKind: t('model'), timestampMs: forecastPoint.validTimeMs,
      averageMps: forecastPoint.meanWindMps, gustMps: forecastPoint.gustMps, fromDegrees: forecastPoint.windFromDeg,
      comparisons: compareWindToLimits({ averageMps: forecastPoint.meanWindMps, gustMps: forecastPoint.gustMps, fromDegrees: forecastPoint.windFromDeg }, limits, comparisonFreshness('nwp', forecastPoint.referenceTimeMs, nowMs)),
    })
  }

  const metricValue = (group: ComparisonGroup, row: LimitComparison): string => {
    if (row.metric === 'average') return formatWind(group.averageMps, windUnit)
    if (row.metric === 'gust') return formatWind(group.gustMps, windUnit)
    return formatDirection(group.fromDegrees, locale)
  }
  const enteredLimit = (row: LimitComparison): string => {
    if (row.metric === 'average') return formatWind(limits.maxAverageMps, windUnit)
    if (row.metric === 'gust') return formatWind(limits.maxGustMps, windUnit)
    if (limits.allowedFromSectors.length === 0) return '—'
    return limits.allowedFromSectors
      .map((sector) => locale === 'de' ? germanWindSector[sector] : sector)
      .join(', ')
  }

  return (
    <section className="card limit-comparisons" aria-labelledby="limit-comparisons-heading">
      <h2 id="limit-comparisons-heading">{copy.heading}</h2>
      <p className="notice limits-disclaimer">{t('limitsDisclaimer')}</p>
      {groups.length === 0 ? <p>{copy.none}</p> : groups.map((group) => {
        const count = group.comparisons.filter((row) => row.status === 'over-entered-limit' || row.status === 'outside-selected-sector').length
        return (
          <article key={group.key} className="comparison-group">
            <div className="card-heading-row"><div><h3>{group.title}</h3><p className="muted">{group.sourceKind} · {formatVienna(group.timestampMs)}</p></div><strong>{copy.count}: {count}</strong></div>
            <div className="data-table-wrap" tabIndex={0}><table><thead><tr><th>{locale === 'de' ? 'Messgröße' : 'Metric'}</th><th>{copy.value}</th><th>{copy.entered}</th><th>{copy.result}</th></tr></thead><tbody>
              {group.comparisons.map((row) => <tr key={row.metric} data-comparison-status={row.status}><td>{row.metric === 'average' ? copy.average : row.metric === 'gust' ? copy.gust : copy.direction}</td><td>{metricValue(group, row)}</td><td>{enteredLimit(row)}</td><td>{copy.statuses[row.status]}</td></tr>)}
            </tbody></table></div>
          </article>
        )
      })}
    </section>
  )
}
