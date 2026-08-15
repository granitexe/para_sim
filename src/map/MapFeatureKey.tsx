import type { SiteId } from '../domain/sites'
import { flightAreas, siteRestrictions } from '../domain/sites'
import { useI18n } from '../i18n/I18nProvider'

interface MapFeatureKeyProps {
  siteId?: SiteId
}

export function MapFeatureKey({ siteId }: MapFeatureKeyProps) {
  const { locale } = useI18n()
  const areas = siteId === undefined ? flightAreas : flightAreas.filter((area) => area.siteId === siteId)
  const restrictions = siteId === undefined
    ? siteRestrictions
    : siteRestrictions.filter((restriction) => restriction.siteId === siteId)
  const copy = locale === 'de'
    ? {
        label: 'Kartenzeichen',
        takeoff: 'Startplatz',
        landing: 'Landeplatz',
        restriction: 'Regel-/Luftraumhinweis',
        details: 'Kartierte Start-, Lande- und Einschränkungshinweise',
        altitude: 'Höhe',
        directions: 'Windrichtungen',
        caveat: 'Die OpenFlightMaps-Luftfahrtkarte und die Hinweise sind keine Luftraum- oder NOTAM-Freigabe. Aktuelle AIP, NOTAMs und lokale Regeln bleiben maßgeblich.',
      }
    : {
        label: 'Map symbols',
        takeoff: 'Takeoff',
        landing: 'Landing',
        restriction: 'Rule/airspace caution',
        details: 'Mapped takeoff, landing, and restriction notices',
        altitude: 'Elevation',
        directions: 'Wind directions',
        caveat: 'The OpenFlightMaps aviation chart and these notices are not airspace or NOTAM clearance. Current AIP, NOTAMs, and local rules remain authoritative.',
      }

  return (
    <div className="map-feature-key" aria-label={copy.label}>
      <div className="map-feature-symbols">
        <span><i className="feature-symbol takeoff-symbol" aria-hidden="true" />{copy.takeoff}</span>
        <span><i className="feature-symbol landing-symbol" aria-hidden="true" />{copy.landing}</span>
        <span><i className="feature-symbol restriction-symbol" aria-hidden="true">!</i>{copy.restriction}</span>
      </div>
      <details>
        <summary>{copy.details}</summary>
        <ul className="feature-source-list">
          {areas.map((area) => (
            <li key={area.id}>
              <strong>{area.name[locale]}</strong>
              {area.elevationM === null ? null : ` · ${copy.altitude}: ${area.elevationM} m`}
              {area.directions === null ? null : ` · ${copy.directions}: ${area.directions}`}
              {' · '}
              <a href={area.source.url} target="_blank" rel="noreferrer">{area.source.label[locale]}</a>
            </li>
          ))}
          {restrictions.map((restriction) => (
            <li key={restriction.id}>
              <strong>{restriction.name[locale]}:</strong> {restriction.detail[locale]}
              {' · '}
              <a href={restriction.source.url} target="_blank" rel="noreferrer">{restriction.source.label[locale]}</a>
            </li>
          ))}
        </ul>
        <p className="muted">{copy.caveat}</p>
      </details>
    </div>
  )
}
