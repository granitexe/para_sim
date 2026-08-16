import { deriveFlightMetrics, replayAltitudeSource, selectedAltitudeM, type Flight } from '../../domain/flight'
import type { WindUnit } from '../../domain/limits'
import { windFromMps } from '../../domain/limits'
import { useI18n } from '../../i18n/I18nProvider'

interface FlightSummaryProps {
  flight: Flight
  timestampMs: number
  windUnit: WindUnit
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`
}

function formatRange(range: readonly [number, number] | null): string {
  return range === null ? '—' : `${Math.round(range[0])}–${Math.round(range[1])} m`
}

function localizedWarning(warning: string, locale: 'en' | 'de'): string {
  if (locale === 'en') return warning
  const exact: Record<string, string> = {
    'Invalid V fixes split the replay track.': 'Ungültige V-Fixes teilen die Wiedergabespur.',
    'Fixes with unusable timestamps or coordinates were removed and split the track.': 'Fixes mit unbrauchbarer Zeit oder Koordinate wurden entfernt und teilen die Spur.',
    'Non-increasing fix times split the replay track.': 'Nicht ansteigende Fix-Zeiten teilen die Wiedergabespur.',
    'Fix gaps longer than 10 seconds split the replay track.': 'Fix-Lücken über 10 Sekunden teilen die Wiedergabespur.',
    'One-point track segments were dropped because they cannot form a route.': 'Spurabschnitte mit nur einem Punkt wurden entfernt.',
    'GPS/GEO altitude is retained for the data panel; the 2D replay does not compare it with terrain.': 'GPS/GEO-Höhe bleibt im Datenbereich erhalten; die 2D-Wiedergabe vergleicht sie nicht mit dem Gelände.',
    'GNSS altitude uses an ellipsoid or undeclared vertical datum; it is retained for data only.': 'GNSS-Höhe verwendet ein Ellipsoid oder ein nicht angegebenes vertikales Datum; sie bleibt nur als Datenwert erhalten.',
    'GNSS altitude is unavailable; pressure/ISA altitude is retained for data only and is not drawn as map height.': 'GNSS-Höhe fehlt; Druck/ISA-Höhe bleibt nur als Datenwert erhalten und wird nicht als Kartenhöhe dargestellt.',
    'Source altitude is unavailable; replay remains a 2D map track.': 'Quellhöhe fehlt; die Wiedergabe bleibt eine 2D-Kartenspur.',
  }
  if (exact[warning] !== undefined) return exact[warning]
  const parser = /^([A-Z]) record at line (\\d+) was skipped by the IGC parser\\.$/u.exec(warning)
  if (parser !== null) return `${parser[1]}-Datensatz in Zeile ${parser[2]} wurde vom IGC-Parser übersprungen.`
  const decimation = /^The rendered route was decimated from (\\d+) to (\\d+) points; statistics still use the full track\\.$/u.exec(warning)
  if (decimation !== null) return `Die dargestellte Spur wurde von ${decimation[1]} auf ${decimation[2]} Punkte reduziert; Statistiken nutzen weiterhin die vollständige Spur.`
  return warning
}

export function FlightSummary({ flight, timestampMs, windUnit }: FlightSummaryProps) {
  const { locale, formatUtc } = useI18n()
  const source = replayAltitudeSource(flight)
  const metrics = deriveFlightMetrics(flight, timestampMs)
  const altitude = metrics === null ? null : selectedAltitudeM(metrics.point, source)
  const localTag = locale === 'de' ? 'de-AT' : 'en-GB'
  const localFormatter = new Intl.DateTimeFormat(localTag, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  })
  const firstPoint = flight.segments[0]!.points[0]!
  const finalSegment = flight.segments[flight.segments.length - 1]!
  const lastPoint = finalSegment.points[finalSegment.points.length - 1]!
  const speedLabel = windUnit === 'kmh' ? 'km/h' : windUnit === 'kt' ? 'kt' : 'm/s'
  const speed =
    metrics?.groundSpeedMps === null || metrics?.groundSpeedMps === undefined
      ? '—'
      : `${windFromMps(metrics.groundSpeedMps, windUnit).toFixed(1)} ${speedLabel}`
  const copy =
    locale === 'de'
      ? {
          heading: 'Flugübersicht',
          filename: 'Datei',
          site: 'Ausgelesener Flugort',
          date: 'IGC-Datum (UTC)',
          start: 'Start',
          end: 'Ende',
          fixes: 'Verwendbare Fixes',
          duration: 'Dauer',
          distance: '2D-Strecke',
          gpsRange: 'GPS/GEO-Höhenbereich',
          pressureRange: 'Druck/ISA-Höhenbereich',
          currentAltitude: 'Aktuelle Quellhöhe (nur Daten)',
          speed: 'Geschwindigkeit über Grund (abgeleitet)',
          vario: 'Vario (abgeleitet)',
          datum: 'Höhenbezug der Daten',
          warnings: 'Hinweise zum Flugprotokoll',
          noSite: 'Nicht angegeben',
          sourceNone: 'Keine Quellhöhe; 2D-Kartenwiedergabe',
          sourceGps: 'GPS/GEO bzw. GNSS-Quelldatum; nicht als Kartenhöhe dargestellt',
          sourcePressure: 'Druck/ISA-Daten; nicht als Kartenhöhe dargestellt',
        }
      : {
          heading: 'Flight summary',
          filename: 'File',
          site: 'Parsed site',
          date: 'IGC date (UTC)',
          start: 'Start',
          end: 'End',
          fixes: 'Usable fixes',
          duration: 'Duration',
          distance: '2D path distance',
          gpsRange: 'GPS/GEO altitude range',
          pressureRange: 'Pressure/ISA altitude range',
          currentAltitude: 'Current source altitude (data only)',
          speed: 'Ground speed (derived)',
          vario: 'Vario (derived)',
          datum: 'Altitude data reference',
          warnings: 'Flight-log notices',
          noSite: 'Not supplied',
          sourceNone: 'No source altitude; 2D map replay',
          sourceGps: 'GPS/GEO or declared GNSS source datum; not drawn as map height',
          sourcePressure: 'Pressure/ISA data; not drawn as map height',
        }

  const sourceText =
    source === 'none' ? copy.sourceNone : source === 'pressure' ? copy.sourcePressure : copy.sourceGps

  return (
    <section className="card" aria-labelledby="flight-summary-heading">
      <h2 id="flight-summary-heading">{copy.heading}</h2>
      <dl className="summary-grid">
        <div>
          <dt>{copy.filename}</dt>
          <dd>{flight.filename}</dd>
        </div>
        <div>
          <dt>{copy.site}</dt>
          <dd>{flight.site ?? copy.noSite}</dd>
        </div>
        <div>
          <dt>{copy.date}</dt>
          <dd>{flight.dateUtc ?? '—'}</dd>
        </div>
        <div>
          <dt>{copy.start}</dt>
          <dd>
            {localFormatter.format(firstPoint.timestampMs)} · {formatUtc(firstPoint.timestampMs)}
          </dd>
        </div>
        <div>
          <dt>{copy.end}</dt>
          <dd>
            {localFormatter.format(lastPoint.timestampMs)} · {formatUtc(lastPoint.timestampMs)}
          </dd>
        </div>
        <div>
          <dt>{copy.fixes}</dt>
          <dd>{flight.pointCount.toLocaleString(localTag)}</dd>
        </div>
        <div>
          <dt>{copy.duration}</dt>
          <dd>{formatDuration(flight.durationMs)}</dd>
        </div>
        <div>
          <dt>{copy.distance}</dt>
          <dd>{(flight.distanceM / 1000).toFixed(3)} km</dd>
        </div>
        <div>
          <dt>{copy.gpsRange}</dt>
          <dd>{formatRange(flight.gpsAltitudeRangeM)}</dd>
        </div>
        <div>
          <dt>{copy.pressureRange}</dt>
          <dd>{formatRange(flight.pressureAltitudeRangeM)}</dd>
        </div>
        <div>
          <dt>{copy.currentAltitude}</dt>
          <dd>{altitude === null ? '—' : `${Math.round(altitude)} m`}</dd>
        </div>
        <div>
          <dt>{copy.speed}</dt>
          <dd>{speed}</dd>
        </div>
        <div>
          <dt>{copy.vario}</dt>
          <dd>{metrics?.varioMps === null || metrics?.varioMps === undefined ? '—' : `${metrics.varioMps.toFixed(1)} m/s`}</dd>
        </div>
        <div>
          <dt>{copy.datum}</dt>
          <dd>{sourceText}</dd>
        </div>
      </dl>
      {flight.warnings.length > 0 ? (
        <details>
          <summary>{copy.warnings} ({flight.warnings.length})</summary>
          <ul className="warning-list">
            {flight.warnings.map((warning, index) => (
              <li key={`${index}-${warning}`}>{localizedWarning(warning, locale)}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  )
}
