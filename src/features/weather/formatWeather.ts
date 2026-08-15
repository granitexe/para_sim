import {
  germanWindSector,
  windFromMps,
  windSectorFromDegrees,
  type WindUnit,
} from '../../domain/limits'
import type { ResourceUnavailableReason } from '../../domain/weather'

export function windUnitLabel(unit: WindUnit): string {
  if (unit === 'kmh') return 'km/h'
  if (unit === 'kt') return 'kt'
  return 'm/s'
}

export function formatWind(valueMps: number | null, unit: WindUnit): string {
  return valueMps === null ? '—' : `${windFromMps(valueMps, unit).toFixed(1)} ${windUnitLabel(unit)}`
}

export function formatDirection(degrees: number | null, locale: 'en' | 'de'): string {
  if (degrees === null) return '—'
  const sector = windSectorFromDegrees(degrees)
  const label = locale === 'de' ? germanWindSector[sector] : sector
  return `${Math.round(degrees)}° ${label}`
}

export function formatAge(timestampMs: number, nowMs: number, locale: 'en' | 'de'): string {
  const minutes = Math.max(0, Math.floor((nowMs - timestampMs) / 60_000))
  if (minutes < 1) return locale === 'de' ? 'unter 1 Minute' : 'under 1 minute'
  if (minutes < 60) return locale === 'de' ? `${minutes} Min.` : `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return locale === 'de' ? `${hours} Std. ${remainder} Min.` : `${hours} h ${remainder} min`
}

export function formatCoordinate(latitude: number, longitude: number): string {
  return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`
}

export function downwindArrowTransform(fromDegrees: number | null): string | undefined {
  return fromDegrees === null ? undefined : `rotate(${(fromDegrees + 180) % 360}deg)`
}

export function resourceUnavailableText(
  reason: ResourceUnavailableReason,
  locale: 'en' | 'de',
): string {
  const english: Record<ResourceUnavailableReason, string> = {
    'local-rate-limit': 'The local hourly request budget is exhausted.',
    'http-429': 'The provider is rate-limiting requests.',
    'schema-mismatch': 'The provider response format was not recognized.',
    cors: 'The request was blocked by CORS or the network.',
    offline: 'The browser is offline.',
    'fetch-failure': 'The provider request failed.',
    aborted: 'The request was cancelled.',
    'missing-data': 'Required source data is missing.',
  }
  const german: Record<ResourceUnavailableReason, string> = {
    'local-rate-limit': 'Das lokale stündliche Abfragebudget ist ausgeschöpft.',
    'http-429': 'Der Anbieter begrenzt derzeit Abfragen.',
    'schema-mismatch': 'Das Antwortformat des Anbieters wurde nicht erkannt.',
    cors: 'Die Abfrage wurde durch CORS oder das Netzwerk blockiert.',
    offline: 'Der Browser ist offline.',
    'fetch-failure': 'Die Anbieterabfrage ist fehlgeschlagen.',
    aborted: 'Die Abfrage wurde abgebrochen.',
    'missing-data': 'Erforderliche Quelldaten fehlen.',
  }
  return locale === 'de' ? german[reason] : english[reason]
}
