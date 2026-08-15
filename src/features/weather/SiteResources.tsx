import {
  austroControlPreflightUrl,
  geosphereWarningsUrl,
  sites,
  type SiteId,
} from '../../domain/sites'
import { useI18n } from '../../i18n/I18nProvider'

export function SiteResources({ siteId }: { siteId: SiteId }) {
  const { locale, t } = useI18n()
  const site = sites[siteId]
  const copy = locale === 'de'
    ? {
        heading: 'Fluggebiets-, Warnungs- und Flugvorbereitungsquellen',
        rules: 'Lokale Fluggebietsregeln',
        warnings: 'Amtliche GeoSphere-Warnungsseite',
        preflight: 'Austro Control Flugvorbereitung',
        coordinates: 'Öffentliche Gebietskoordinate',
        thalerhof: 'Der Gelderkogel liegt nahe dem vom Club beschriebenen Thalerhof-Anflugproblem. Prüfe die dort genannten Höhenbeschränkungen und die aktuelle offizielle Luftraumlage.',
      }
    : {
        heading: 'Site, warning, and pre-flight sources',
        rules: 'Local flying-site rules',
        warnings: 'Official GeoSphere warning page',
        preflight: 'Austro Control pre-flight preparation',
        coordinates: 'Public site coordinate',
        thalerhof: 'Gelderkogel is near the Thalerhof approach concern described by the club. Check the stated height constraints and current official airspace information.',
      }
  return (
    <section className="card site-resources" aria-labelledby="site-resources-heading">
      <h2 id="site-resources-heading">{copy.heading}</h2>
      <p className="notice">{t('airspaceDisclaimer')}</p>
      {siteId === 'gelderkogel' ? <p>{copy.thalerhof}</p> : null}
      <ul>
        {site.notes[locale].map((note) => <li key={note}>{note}</li>)}
      </ul>
      <div className="resource-links">
        <a href={site.rules.url} target="_blank" rel="noreferrer">{copy.rules}: {site.rules.label[locale]}</a>
        <a href={geosphereWarningsUrl} target="_blank" rel="noreferrer">{copy.warnings}</a>
        <a href={austroControlPreflightUrl} target="_blank" rel="noreferrer">{copy.preflight}</a>
        <a href={site.coordinateSource.url} target="_blank" rel="noreferrer">{copy.coordinates}: {site.coordinateSource.label[locale]}</a>
      </div>
    </section>
  )
}
