import { lazy, Suspense, useEffect, useRef, useState, type ChangeEvent } from 'react'
import type { Flight } from '../../domain/flight'
import type { WindUnit } from '../../domain/limits'
import { useI18n } from '../../i18n/I18nProvider'
import { IgcImportError, parseIgcFile } from '../../lib/igcAdapter'
import { MapFeatureKey } from '../../map/MapFeatureKey'
import { mapTilerConfigured, type ProviderPolicy } from '../../map/providers'
import { FlightSummary } from './FlightSummary'

const LazyFlightReplayMap = lazy(() =>
  import('./FlightReplayMap').then((module) => ({ default: module.FlightReplayMap })),
)

interface FlightPageProps {
  flight: Flight | null
  windUnit: WindUnit
  mapStyle: ProviderPolicy
  onImportStart: () => void
  onFlightLoaded: (flight: Flight) => void
  onRemoveFlight: () => void
  onSelectMapStyle: (style: ProviderPolicy) => void
}

function importErrorText(error: unknown, locale: 'en' | 'de'): string {
  if (!(error instanceof IgcImportError)) {
    return locale === 'de'
      ? 'Die Datei konnte nicht lokal eingelesen werden. Wähle eine gültige IGC-Textdatei.'
      : 'The file could not be parsed locally. Choose a valid text IGC file.'
  }
  if (locale === 'en') return error.message
  const byCode: Record<IgcImportError['code'], string> = {
    'file-too-large': 'IGC-Dateien dürfen höchstens 10 MiB groß sein.',
    'unsupported-file': 'Wähle eine .igc-Datei oder eine Textdatei mit erkennbaren IGC-Datensätzen.',
    'empty-file': 'Die ausgewählte Datei ist leer.',
    'binary-file': 'Die ausgewählte Datei enthält Binärdaten und ist keine IGC-Textdatei.',
    'too-many-fixes': 'Die IGC enthält mehr als 100.000 Fix-Datensätze und wurde nicht eingelesen.',
    'invalid-igc': 'Die IGC ist fehlerhaft oder enthält nicht alle erforderlichen Datensätze.',
    'insufficient-track': 'Die IGC benötigt mindestens zwei verwendbare Fixes in einem zusammenhängenden Abschnitt.',
    'segment-budget': 'Die Spur enthält zu viele getrennte Abschnitte für das sichere Darstellungsbudget.',
  }
  return byCode[error.code]
}

export function FlightPage({
  flight,
  windUnit,
  mapStyle,
  onImportStart,
  onFlightLoaded,
  onRemoveFlight,
  onSelectMapStyle,
}: FlightPageProps) {
  const { locale, t } = useI18n()
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [currentTimestamp, setCurrentTimestamp] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const importSequence = useRef(0)

  useEffect(() => {
    if (flight !== null) setCurrentTimestamp(flight.segments[0]!.points[0]!.timestampMs)
  }, [flight])

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0]
    event.target.value = ''
    if (selectedFile === undefined) return
    const sequence = importSequence.current + 1
    importSequence.current = sequence
    setError(null)
    setImporting(true)
    onImportStart()
    try {
      const parsed = await parseIgcFile(selectedFile)
      if (sequence === importSequence.current) onFlightLoaded(parsed)
    } catch (parseError) {
      if (sequence === importSequence.current) setError(importErrorText(parseError, locale))
    } finally {
      if (sequence === importSequence.current) setImporting(false)
    }
  }

  const removeFlight = () => {
    importSequence.current += 1
    setImporting(false)
    setError(null)
    if (inputRef.current !== null) inputRef.current.value = ''
    onRemoveFlight()
  }

  const emptyCopy =
    locale === 'de'
      ? {
          help: 'XCTrack- und andere IGC-Protokolle werden ausschließlich im Arbeitsspeicher verarbeitet.',
          errorHeading: 'Import nicht möglich',
        }
      : {
          help: 'XCTrack and other IGC logs are processed only in browser memory.',
          errorHeading: 'Import failed',
        }

  if (flight === null) {
    return (
      <section className="flight-empty" aria-labelledby="flight-heading">
        <div className="flight-empty-card">
          <p className="eyebrow">{t('appName')}</p>
          <h1 id="flight-heading">{t('flightTitle')}</h1>
          <p className="lead">{t('privacyPromise')}</p>
          <label className="file-button primary-button">
            <span>{importing ? t('loadingFlight') : t('importFlight')}</span>
            <input
              ref={inputRef}
              type="file"
              accept=".igc,text/plain"
              disabled={importing}
              onChange={(event) => void handleFile(event)}
            />
          </label>
          <p className="muted">{emptyCopy.help}</p>
          {error !== null ? (
            <div className="error-card" role="alert">
              <strong>{emptyCopy.errorHeading}</strong>
              <p>{error}</p>
            </div>
          ) : null}
        </div>
      </section>
    )
  }

  const replayKey = `${flight.filename}-${flight.segments[0]!.points[0]!.timestampMs}-${flight.pointCount}`
  return (
    <div className="map-detail-layout flight-layout">
      <Suspense
        fallback={
          <div className="map-panel map-text-fallback" role="status">
            {locale === 'de' ? 'Flugkarte wird geladen…' : 'Loading flight map…'}
          </div>
        }
      >
        <LazyFlightReplayMap
          key={replayKey}
          flight={flight}
          providerPolicy={mapStyle}
          onTimeChange={setCurrentTimestamp}
        />
      </Suspense>
      <aside className="detail-panel" aria-label={locale === 'de' ? 'Flugdetails' : 'Flight details'}>
        <div className="card-stack">
          <section className="privacy-card">
            <p>
              {mapStyle === 'local'
                ? t('privateMap')
                : mapStyle === 'topographic'
                  ? t('topographicMapEnabled')
                  : mapStyle === 'aviation'
                    ? t('aviationMapEnabled')
                    : t('satelliteMapEnabled')}
            </p>
            <fieldset className="map-style-picker">
              <legend>{t('mapStyle')}</legend>
              <div className="segmented">
                <button type="button" aria-pressed={mapStyle === 'local'} onClick={() => onSelectMapStyle('local')}>
                  {t('privateOverview')}
                </button>
                <button type="button" aria-pressed={mapStyle === 'topographic'} onClick={() => onSelectMapStyle('topographic')}>
                  {t('topographicMap')}
                </button>
                <button type="button" aria-pressed={mapStyle === 'aviation'} onClick={() => onSelectMapStyle('aviation')}>
                  {t('aviationMap')}
                </button>
                {mapTilerConfigured() ? (
                  <button type="button" aria-pressed={mapStyle === 'maptiler'} onClick={() => onSelectMapStyle('maptiler')}>
                    {t('satelliteMap')}
                  </button>
                ) : null}
              </div>
            </fieldset>
          </section>
          <MapFeatureKey />
          <div className="control-row flight-file-actions">
            <label className="file-button">
              <span>{importing ? t('loadingFlight') : t('replaceFlight')}</span>
              <input
                ref={inputRef}
                type="file"
                accept=".igc,text/plain"
                disabled={importing}
                onChange={(event) => void handleFile(event)}
              />
            </label>
            <button type="button" onClick={removeFlight}>{t('removeFlight')}</button>
          </div>
          {error !== null ? <p className="error-card" role="alert">{error}</p> : null}
          <FlightSummary flight={flight} timestampMs={currentTimestamp} windUnit={windUnit} />
        </div>
      </aside>
    </div>
  )
}
