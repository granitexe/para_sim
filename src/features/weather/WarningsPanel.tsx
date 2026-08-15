import type { AutomatedThunderstormStatus, LoadState } from '../../domain/weather'
import type { OfficialWarningResult } from '../../services/geosphereClient'
import { useI18n } from '../../i18n/I18nProvider'
import { formatAge, resourceUnavailableText } from './formatWeather'

interface WarningsPanelProps {
  official: LoadState<OfficialWarningResult>
  thunderstorm: LoadState<AutomatedThunderstormStatus>
  nowMs: number
}

export function WarningsPanel({ official, thunderstorm, nowMs }: WarningsPanelProps) {
  const { locale, formatVienna, t } = useI18n()
  const copy =
    locale === 'de'
      ? {
          loading: 'Amtliche Warnungen werden geprüft…',
          unavailable: 'Amtliche Warnungen konnten nicht geprüft werden.',
          thunder: 'Eine automatisierte amtliche Gewitterwarnung ist aktiv.',
          intensity: 'Unveränderte Anbieterintensität',
          level: 'Amtliche Stufe',
          type: 'Amtlicher Typ',
          interval: 'Gültigkeit',
          effects: 'Auswirkungen',
          recommendations: 'Empfehlungen',
          checked: 'Zuletzt geprüft',
          intervalUnavailable: 'Maschinenlesbarer Zeitraum nicht verfügbar',
        }
      : {
          loading: 'Checking official warnings…',
          unavailable: 'Official warnings could not be checked.',
          thunder: 'An automated official thunderstorm warning is active.',
          intensity: 'Unmodified provider intensity',
          level: 'Official level',
          type: 'Official type',
          interval: 'Valid interval',
          effects: 'Effects',
          recommendations: 'Recommendations',
          checked: 'Last checked',
          intervalUnavailable: 'Machine-readable interval unavailable',
        }

  return (
    <section className="card warning-panel" aria-labelledby="official-warning-heading">
      <h2 id="official-warning-heading">{t('officialWarnings')}</h2>
      {official.status === 'idle' || official.status === 'loading' ? (
        <p aria-live="polite">{copy.loading}</p>
      ) : official.status === 'unavailable' ? (
        <div className="source-unavailable" role="status">
          <strong>{copy.unavailable}</strong>
          <p>{resourceUnavailableText(official.reason, locale)}</p>
          <small>{copy.checked}: {formatVienna(official.checkedAtMs)}</small>
        </div>
      ) : official.data.warnings.length === 0 ? (
        <div>
          <p>{t('noOfficialWarning')}</p>
          <small>{copy.checked}: {formatVienna(official.fetchedAtMs)} · {formatAge(official.fetchedAtMs, nowMs, locale)}</small>
        </div>
      ) : (
        <div className="official-warning-list">
          {official.data.warnings.map((warning, index) => (
            <article
              key={`${warning.type ?? 'unknown'}-${warning.startTimeMs ?? warning.providerBeginText ?? index}`}
              className={`official-warning level-${warning.officialLevel ?? 'unknown'}`}
            >
              <div className="warning-meta">
                <span>{copy.level}: {warning.officialLevel ?? '—'}</span>
                <span>{copy.type}: {warning.type ?? '—'}</span>
              </div>
              <p className="official-text">{warning.text || '—'}</p>
              <dl className="summary-grid compact-grid">
                <div>
                  <dt>{copy.interval}</dt>
                  <dd>
                    {warning.machineReadableIntervalAvailable && warning.startTimeMs !== null && warning.endTimeMs !== null
                      ? `${formatVienna(warning.startTimeMs)} – ${formatVienna(warning.endTimeMs)}`
                      : `${warning.providerBeginText ?? '—'} – ${warning.providerEndText ?? '—'} · ${copy.intervalUnavailable}`}
                  </dd>
                </div>
                <div><dt>{copy.effects}</dt><dd>{warning.effects ?? '—'}</dd></div>
                <div><dt>{copy.recommendations}</dt><dd>{warning.recommendations ?? '—'}</dd></div>
              </dl>
              <p className="attribution">
                {t('source')}: <a href={warning.sourceUrl} target="_blank" rel="noreferrer">GeoSphere Austria official warnings</a> · {copy.checked}: {formatVienna(warning.fetchedAtMs)}
              </p>
            </article>
          ))}
        </div>
      )}

      {thunderstorm.status === 'unavailable' ? (
        <p className="source-unavailable" role="status">{resourceUnavailableText(thunderstorm.reason, locale)}</p>
      ) : thunderstorm.status === 'available' && thunderstorm.data.active ? (
        <div className="official-thunderstorm">
          <strong>{copy.thunder}</strong>
          {thunderstorm.data.rawIntensity !== null ? (
            <p>{copy.intensity}: {String(thunderstorm.data.rawIntensity)}</p>
          ) : null}
          <p className="attribution">{t('source')}: <a href={thunderstorm.data.sourceUrl} target="_blank" rel="noreferrer">GeoSphere automated thunderstorm warning</a></p>
        </div>
      ) : null}
    </section>
  )
}
