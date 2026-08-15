export type SiteId = 'schoeckl' | 'gelderkogel'

export interface SiteLink {
  label: { en: string; de: string }
  url: string
}

export interface SiteConfig {
  id: SiteId
  name: { en: string; de: string }
  latitude: number
  longitude: number
  elevationM: number
  directStationId: string | null
  coordinateSource: SiteLink
  rules: SiteLink
  notes: { en: string[]; de: string[] }
}

export const sites: Record<SiteId, SiteConfig> = {
  schoeckl: {
    id: 'schoeckl',
    name: { en: 'Schöckl', de: 'Schöckl' },
    latitude: 47.1986111111,
    longitude: 15.4663888889,
    elevationM: 1443,
    directStationId: '11241',
    coordinateSource: {
      label: { en: 'GeoSphere TAWES station metadata', de: 'GeoSphere-TAWES-Stationsmetadaten' },
      url: 'https://dataset.api.hub.geosphere.at/v1/station/current/tawes-v1-10min/metadata',
    },
    rules: {
      label: { en: 'Schöckl flying-site information', de: 'Schöckl-Fluggebietsinformation' },
      url: 'https://www.paragleitclub-steiermark.at/wp/schockl-fluggebiet-informationstafel/',
    },
    notes: {
      en: ['Read the current club site information before launch.'],
      de: ['Vor dem Start die aktuellen Fluggebietsinformationen des Clubs lesen.'],
    },
  },
  gelderkogel: {
    id: 'gelderkogel',
    name: { en: 'Gelderkogel', de: 'Gelderkogel' },
    latitude: 47.310512,
    longitude: 15.47899,
    elevationM: 1195,
    directStationId: null,
    coordinateSource: {
      label: { en: 'OpenStreetMap / GeoNames peak coordinate', de: 'OpenStreetMap-/GeoNames-Gipfelkoordinate' },
      url: 'https://www.openstreetmap.org/?mlat=47.310512&mlon=15.47899#map=15/47.310512/15.47899',
    },
    rules: {
      label: { en: 'Gelderkogel flying-site rules', de: 'Gelderkogel-Fluggebietsregeln' },
      url: 'https://www.paragleitclub-steiermark.at/wp/fluggebiet-gelderkogel/',
    },
    notes: {
      en: [
        'The club describes this as a southerly-wind site.',
        'Local membership and landing rules apply.',
        'The club warns about the nearby Thalerhof approach and its height constraints.',
      ],
      de: [
        'Der Club beschreibt das Gebiet als Fluggebiet für Südwind.',
        'Lokale Mitgliedschafts- und Landeregeln gelten.',
        'Der Club weist auf den nahen Thalerhof-Anflug und dessen Höhenbeschränkungen hin.',
      ],
    },
  },
}

export const geosphereWarningsUrl = 'https://warnungen.zamg.at/'
export const austroControlPreflightUrl =
  'https://www.austrocontrol.at/en/pilots/pre-flight_preparation'

export const siteIds = ['schoeckl', 'gelderkogel'] as const
