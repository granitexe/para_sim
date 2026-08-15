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
    'One-point altitude segments were dropped because they cannot form a 3D route.': 'Höhenabschnitte mit nur einem Punkt wurden aus der 3D-Spur entfernt.',
    'GPS/GEO heights and EGM96 terrain are shown without a manual shift; residual terrain offset may remain.': 'GPS/GEO-Höhen und EGM96-Gelände werden ohne manuelle Verschiebung gezeigt; ein Restversatz kann bleiben.',
    'GNSS heights use an ellipsoid or undeclared vertical datum; terrain offset is unknown.': 'GNSS-Höhen verwenden ein Ellipsoid oder ein nicht deklariertes Höhendatum; der Geländeversatz ist unbekannt.',
    'GNSS altitude is unavailable; replay uses pressure/ISA altitude, which does not share the terrain datum.': 'GNSS-Höhe fehlt; die Wiedergabe nutzt Druck/ISA-Höhe, die nicht dasselbe Datum wie das Gelände hat.',
    'Source altitude is unavailable; replay is a 2D terrain-draped track.': 'Quellhöhe fehlt; die Wiedergabe ist eine am Gelände anliegende 2D-Spur.',
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
          currentAltitude: 'Aktuelle Quellhöhe',
          speed: 'Geschwindigkeit über Grund (abgeleitet)',
          vario: 'Vario (abgeleitet)',
          datum: 'Wiedergabe-Höhenbezug',
          terrain: 'DEM-Gelände',
          warnings: 'Hinweise zum Flugprotokoll',
          noSite: 'Nicht angegeben',
          sourceNone: 'Keine Quellhöhe; 2D, am Gelände anliegend',
          sourceGps: 'GPS/GEO bzw. GNSS-Quelldatum',
          sourcePressure: 'Druck/ISA; nicht mit DEM-Datum gleichzusetzen',
          terrainText: 'DEM-Gelände ist modelliert; kein gemessenes AGL.',
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
          currentAltitude: 'Current source altitude',
          speed: 'Ground speed (derived)',
          vario: 'Vario (derived)',
          datum: 'Replay altitude reference',
          terrain: 'DEM terrain',
          warnings: 'Flight-log notices',
          noSite: 'Not supplied',
          sourceNone: 'No source altitude; 2D terrain-draped',
          sourceGps: 'GPS/GEO or declared GNSS source datum',
          sourcePressure: 'Pressure/ISA; not interchangeable with the DEM datum',
          terrainText: 'DEM terrain is modeled; it is not measured AGL.',
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
        <div>
          <dt>{copy.terrain}</dt>
          <dd>{copy.terrainText}</dd>
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
