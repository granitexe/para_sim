import { useEffect, useMemo, useRef, useState } from 'react'
import {
  defaultPreferences,
  germanWindSector,
  preferencesSchema,
  resetSiteLimits,
  windFromMps,
  windSectors,
  windToMps,
  type PreferencesV1,
  type SiteLimits,
  type WindSector,
  type WindUnit,
} from '../../domain/limits'
import { sites, siteIds, type SiteId } from '../../domain/sites'
import { useI18n } from '../../i18n/I18nProvider'
import { windUnitLabel } from './formatWeather'

interface SettingsSheetProps {
  preferences: PreferencesV1
  onChange: (preferences: PreferencesV1) => void
  onClose: () => void
}

function copyPreferences(preferences: PreferencesV1): PreferencesV1 {
  return {
    ...preferences,
    limits: {
      schoeckl: { ...preferences.limits.schoeckl, allowedFromSectors: [...preferences.limits.schoeckl.allowedFromSectors] },
      gelderkogel: { ...preferences.limits.gelderkogel, allowedFromSectors: [...preferences.limits.gelderkogel.allowedFromSectors] },
    },
  }
}

function displayLimit(valueMps: number | null, unit: WindUnit): string {
  if (valueMps === null) return ''
  return String(Math.round(windFromMps(valueMps, unit) * 10) / 10)
}

export function SettingsSheet({ preferences, onChange, onClose }: SettingsSheetProps) {
  const { locale, t } = useI18n()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const [draft, setDraft] = useState(() => copyPreferences(preferences))
  const validation = useMemo(() => preferencesSchema.safeParse(draft), [draft])
  const copy = locale === 'de'
    ? {
        heading: 'Persönliche Vergleichsgrenzen', intro: 'Alle Felder sind optional. Leere Felder bedeuten „nicht vergleichen“. Trage deine eigenen Grenzen für den beabsichtigten Start ein.', average: 'Maximaler Mittelwind', gust: 'Maximale Böe', sectors: 'Erlaubte Herkunftssektoren für den beabsichtigten Start', resetSite: 'Grenzen für dieses Gebiet zurücksetzen', resetAll: 'Alle Einstellungen zurücksetzen', save: 'Speichern', invalid: 'Nur Werte über null bis umgerechnet 200 km/h sind erlaubt; die maximale Böe muss mindestens so hoch wie der maximale Mittelwind sein.', unit: 'Anzeige- und Eingabeeinheit',
      }
    : {
        heading: 'Personal comparison limits', intro: 'Every field is optional. Blank means “do not compare.” Enter your own limits for the intended launch.', average: 'Maximum average wind', gust: 'Maximum gust', sectors: 'Allowed from-sectors for the intended launch', resetSite: 'Reset this site’s limits', resetAll: 'Reset all preferences', save: 'Save', invalid: 'Use values above zero through the equivalent of 200 km/h; maximum gust must be at least maximum average wind.', unit: 'Display and input unit',
      }

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog !== null && !dialog.open) dialog.showModal()
    closeRef.current?.focus()
    return () => {
      if (dialog?.open) dialog.close()
    }
  }, [])

  const updateLimit = (siteId: SiteId, key: 'maxAverageMps' | 'maxGustMps', raw: string) => {
    const parsed = raw.trim().length === 0 ? null : Number(raw)
    const normalized = parsed === null || !Number.isFinite(parsed) ? parsed : windToMps(parsed, draft.windUnit)
    setDraft((current) => ({
      ...current,
      limits: {
        ...current.limits,
        [siteId]: { ...current.limits[siteId], [key]: normalized },
      },
    }))
  }

  const toggleSector = (siteId: SiteId, sector: WindSector) => {
    setDraft((current) => {
      const selected = current.limits[siteId].allowedFromSectors
      const allowedFromSectors = selected.includes(sector)
        ? selected.filter((candidate) => candidate !== sector)
        : windSectors.filter((candidate) => candidate === sector || selected.includes(candidate))
      return {
        ...current,
        limits: {
          ...current.limits,
          [siteId]: { ...current.limits[siteId], allowedFromSectors },
        },
      }
    })
  }

  const maxForUnit = windFromMps(200 / 3.6, draft.windUnit)
  const renderSite = (siteId: SiteId, limits: SiteLimits) => (
    <fieldset key={siteId} className="site-limit-fields">
      <legend>{sites[siteId].name[locale]}</legend>
      <div className="limit-number-grid">
        <label>
          <span>{copy.average} ({windUnitLabel(draft.windUnit)})</span>
          <input
            type="number"
            min="0.1"
            max={maxForUnit}
            step="0.1"
            inputMode="decimal"
            value={displayLimit(limits.maxAverageMps, draft.windUnit)}
            onChange={(event) => updateLimit(siteId, 'maxAverageMps', event.target.value)}
          />
        </label>
        <label>
          <span>{copy.gust} ({windUnitLabel(draft.windUnit)})</span>
          <input
            type="number"
            min="0.1"
            max={maxForUnit}
            step="0.1"
            inputMode="decimal"
            value={displayLimit(limits.maxGustMps, draft.windUnit)}
            onChange={(event) => updateLimit(siteId, 'maxGustMps', event.target.value)}
          />
        </label>
      </div>
      <fieldset className="sector-fields">
        <legend>{copy.sectors}</legend>
        <div className="sector-grid">
          {windSectors.map((sector) => (
            <label key={sector}>
              <input
                type="checkbox"
                checked={limits.allowedFromSectors.includes(sector)}
                onChange={() => toggleSector(siteId, sector)}
              />
              <span>{locale === 'de' ? germanWindSector[sector] : sector}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <button type="button" onClick={() => setDraft((current) => resetSiteLimits(current, siteId))}>{copy.resetSite}</button>
    </fieldset>
  )

  return (
    <dialog ref={dialogRef} className="settings-dialog" aria-labelledby="settings-heading" onCancel={(event) => { event.preventDefault(); onClose() }}>
      <div className="settings-sheet">
        <div className="card-heading-row">
          <h2 id="settings-heading">{copy.heading}</h2>
          <button ref={closeRef} type="button" onClick={onClose}>{t('close')}</button>
        </div>
        <p>{copy.intro}</p>
        <p className="notice">{t('limitsDisclaimer')}</p>
        <label className="unit-setting">
          <span>{copy.unit}</span>
          <select
            value={draft.windUnit}
            onChange={(event) => setDraft((current) => ({ ...current, windUnit: event.target.value as WindUnit }))}
          >
            <option value="kmh">km/h</option><option value="mps">m/s</option><option value="kt">kt</option>
          </select>
        </label>
        {siteIds.map((siteId) => renderSite(siteId, draft.limits[siteId]))}
        {!validation.success ? <p className="error-card" role="alert">{copy.invalid}</p> : null}
        <div className="settings-actions">
          <button type="button" onClick={() => { const reset = defaultPreferences(); onChange(reset); onClose() }}>{copy.resetAll}</button>
          <button type="button" className="primary-button" disabled={!validation.success} onClick={() => { if (validation.success) { onChange(validation.data); onClose() } }}>{copy.save}</button>
        </div>
      </div>
    </dialog>
  )
}
