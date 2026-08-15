import type { SiteForecastPoint } from '../../domain/weather'
import { useI18n } from '../../i18n/I18nProvider'

interface ThermalContextProps {
  point: SiteForecastPoint | null
}

function value(number: number | null, suffix: string, digits = 1): string {
  return number === null ? '—' : `${number.toFixed(digits)} ${suffix}`
}

export function ThermalContext({ point }: ThermalContextProps) {
  const { locale, formatVienna, t } = useI18n()
  const copy = locale === 'de'
    ? { unavailable: 'Wähle einen verfügbaren NWP-Zeitschritt.', cape: 'CAPE', cin: 'CIN', radiation: 'Stündliche mittlere Globalstrahlung', cloud: 'Bewölkung', humidity: 'Feuchte', rain: 'Stündlicher Regen', prohibited: 'Es werden keine Thermikstärke, Wolkenbasis, Steigrate, Rotorströmung oder Flugtauglichkeitsbewertung berechnet.' }
    : { unavailable: 'Choose an available NWP time step.', cape: 'CAPE', cin: 'CIN', radiation: 'Hourly mean global radiation', cloud: 'Cloud cover', humidity: 'Humidity', rain: 'Hourly rain', prohibited: 'No thermal strength, cloud base, lift rate, rotor flow, or flyability score is calculated.' }
  return (
    <section className="card" aria-labelledby="thermal-heading">
      <h2 id="thermal-heading">{t('thermalContext')}</h2>
      <p>{t('thermalHelp')}</p>
      <p className="notice">{copy.prohibited}</p>
      {point === null ? <p>{copy.unavailable}</p> : (
        <>
          <p className="muted">{t('validTime')}: {formatVienna(point.validTimeMs)}</p>
          <dl className="summary-grid compact-grid">
            <div><dt>{copy.cape}</dt><dd>{value(point.capeJkg, 'J/kg', 0)}</dd></div>
            <div><dt>{copy.cin}</dt><dd>{value(point.cinJkg, 'J/kg', 0)}</dd></div>
            <div><dt>{copy.radiation}</dt><dd>{value(point.globalRadiationWm2, 'W/m²', 0)}</dd></div>
            <div><dt>{copy.cloud}</dt><dd>{value(point.cloudCoverPercent, '%', 0)}</dd></div>
            <div><dt>{copy.humidity}</dt><dd>{value(point.relativeHumidityPercent, '%', 0)}</dd></div>
            <div><dt>{copy.rain}</dt><dd>{value(point.precipitationMm, 'mm')}</dd></div>
          </dl>
          <p className="attribution">{t('source')}: <a href={point.sourceUrl} target="_blank" rel="noreferrer">GeoSphere Austria nwp-v1-1h-2500m (CC BY 4.0)</a></p>
        </>
      )}
    </section>
  )
}
