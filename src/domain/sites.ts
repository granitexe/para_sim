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

export type FlightAreaKind = 'takeoff' | 'landing'

export interface FlightArea {
  id: string
  siteId: SiteId
  kind: FlightAreaKind
  name: { en: string; de: string }
  latitude: number
  longitude: number
  elevationM: number | null
  directions: string | null
  outline: ReadonlyArray<{ latitude: number; longitude: number }>
  source: SiteLink
}

export interface SiteRestriction {
  id: string
  siteId: SiteId
  name: { en: string; de: string }
  detail: { en: string; de: string }
  latitude: number
  longitude: number
  source: SiteLink
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

export const flightAreas: readonly FlightArea[] = [
  {
    id: 'schoeckl-southeast-takeoff',
    siteId: 'schoeckl',
    kind: 'takeoff',
    name: { en: 'Schöckl southeast takeoff', de: 'Schöckl Startplatz Südost' },
    latitude: 47.201111,
    longitude: 15.475556,
    elevationM: 1423,
    directions: 'S, SE',
    outline: [],
    source: {
      label: { en: 'Paragleitclub Steiermark — Schöckl South', de: 'Paragleitclub Steiermark — Schöckl Süd' },
      url: 'https://www.paragleitclub-steiermark.at/wp/schoeckl-sued/',
    },
  },
  {
    id: 'schoeckl-north-takeoff',
    siteId: 'schoeckl',
    kind: 'takeoff',
    name: { en: 'Schöckl north takeoff', de: 'Schöckl Startplatz Nord' },
    latitude: 47.198333,
    longitude: 15.46,
    elevationM: 1445,
    directions: 'N, NW',
    outline: [],
    source: {
      label: { en: 'Paragleitclub Steiermark — Schöckl North', de: 'Paragleitclub Steiermark — Schöckl Nord' },
      url: 'https://www.paragleitclub-steiermark.at/wp/schoeckl-nord/',
    },
  },
  {
    id: 'st-radegund-pg-landing',
    siteId: 'schoeckl',
    kind: 'landing',
    name: { en: 'St. Radegund PG landing', de: 'Landeplatz St. Radegund PG' },
    latitude: 47.186389,
    longitude: 15.484444,
    elevationM: 780,
    directions: null,
    outline: [],
    source: {
      label: { en: 'Paragleitclub Steiermark — Schöckl South', de: 'Paragleitclub Steiermark — Schöckl Süd' },
      url: 'https://www.paragleitclub-steiermark.at/wp/schoeckl-sued/',
    },
  },
  {
    id: 'st-radegund-hg-landing',
    siteId: 'schoeckl',
    kind: 'landing',
    name: { en: 'St. Radegund HG/PG landing', de: 'Landeplatz St. Radegund HG/PG' },
    latitude: 47.173333,
    longitude: 15.492778,
    elevationM: 665,
    directions: null,
    outline: [],
    source: {
      label: { en: 'Paragleitclub Steiermark — Schöckl South', de: 'Paragleitclub Steiermark — Schöckl Süd' },
      url: 'https://www.paragleitclub-steiermark.at/wp/schoeckl-sued/',
    },
  },
  {
    id: 'plenzengreith-landing',
    siteId: 'schoeckl',
    kind: 'landing',
    name: { en: 'Plenzengreith landing', de: 'Landeplatz Plenzengreith' },
    latitude: 47.213611,
    longitude: 15.479444,
    elevationM: 910,
    directions: null,
    outline: [],
    source: {
      label: { en: 'Paragleitclub Steiermark — Schöckl North', de: 'Paragleitclub Steiermark — Schöckl Nord' },
      url: 'https://www.paragleitclub-steiermark.at/wp/schoeckl-nord/',
    },
  },
  {
    id: 'gelderkogel-takeoff',
    siteId: 'gelderkogel',
    kind: 'takeoff',
    name: { en: 'Gelderkogel training takeoff', de: 'Gelderkogel Schulungs-Startwiese' },
    latitude: 47.3032985,
    longitude: 15.4802163,
    elevationM: null,
    directions: 'S',
    outline: [
      { latitude: 47.3042614, longitude: 15.4798263 },
      { latitude: 47.3040119, longitude: 15.4790512 },
      { latitude: 47.3039595, longitude: 15.4781383 },
      { latitude: 47.3030055, longitude: 15.4786612 },
      { latitude: 47.3023357, longitude: 15.4798265 },
      { latitude: 47.3024992, longitude: 15.4808113 },
      { latitude: 47.3029949, longitude: 15.4822944 },
      { latitude: 47.3037889, longitude: 15.481992 },
      { latitude: 47.303313, longitude: 15.4805052 },
      { latitude: 47.3042614, longitude: 15.4798263 },
    ],
    source: {
      label: { en: 'OpenStreetMap way 33632679', de: 'OpenStreetMap-Weg 33632679' },
      url: 'https://www.openstreetmap.org/way/33632679',
    },
  },
  {
    id: 'gelderkogel-landing',
    siteId: 'gelderkogel',
    kind: 'landing',
    name: { en: 'Gelderkogel training landing', de: 'Gelderkogel Schulungs-Landewiese' },
    latitude: 47.2940445,
    longitude: 15.4904277,
    elevationM: null,
    directions: null,
    outline: [
      { latitude: 47.2950726, longitude: 15.4908199 },
      { latitude: 47.2956529, longitude: 15.490261 },
      { latitude: 47.2957181, longitude: 15.4893167 },
      { latitude: 47.295198, longitude: 15.488733 },
      { latitude: 47.2945958, longitude: 15.4887478 },
      { latitude: 47.2939894, longitude: 15.4891138 },
      { latitude: 47.2936287, longitude: 15.489306 },
      { latitude: 47.2923709, longitude: 15.4900226 },
      { latitude: 47.2930561, longitude: 15.4921773 },
      { latitude: 47.2950726, longitude: 15.4908199 },
    ],
    source: {
      label: { en: 'OpenStreetMap way 33632677', de: 'OpenStreetMap-Weg 33632677' },
      url: 'https://www.openstreetmap.org/way/33632677',
    },
  },
] as const

export const siteRestrictions: readonly SiteRestriction[] = [
  {
    id: 'schoeckl-graz-airspace',
    siteId: 'schoeckl',
    name: { en: 'Graz controlled-airspace caution', de: 'Luftraumhinweis Graz' },
    detail: {
      en: 'Local club guidance describes the Graz control-zone boundary and an approximate 2,140 m height restriction. Verify the current AIP and NOTAMs.',
      de: 'Die lokale Clubinformation nennt die Kontrollzonengrenze Graz und eine ungefähre Höhenbeschränkung von 2.140 m. Aktuelle AIP und NOTAMs prüfen.',
    },
    latitude: 47.201111,
    longitude: 15.475556,
    source: {
      label: { en: 'Hängegleiterclub Steiermark site guidance', de: 'Fluggebietsinformation Hängegleiterclub Steiermark' },
      url: 'http://hgc.flugschule-steiermark.at/index.php?cat=07_Fluggebiet',
    },
  },
  {
    id: 'gelderkogel-west-meadow',
    siteId: 'gelderkogel',
    name: { en: 'West meadow landing restriction', de: 'Landeverbot westliche Wiese' },
    detail: {
      en: 'The club asks pilots not to land, pack, or ground-handle on the meadow west of the road; use the eastern practice slope.',
      de: 'Der Club untersagt Landen, Zusammenpacken und Schirmaufziehen auf der Wiese westlich der Straße; die östliche Übungswiese benutzen.',
    },
    latitude: 47.2940445,
    longitude: 15.4887,
    source: {
      label: { en: 'Paragleitclub Steiermark — Gelderkogel rules', de: 'Paragleitclub Steiermark — Gelderkogel-Regeln' },
      url: 'https://www.paragleitclub-steiermark.at/wp/fluggebiet-gelderkogel/',
    },
  },
  {
    id: 'gelderkogel-thalerhof-approach',
    siteId: 'gelderkogel',
    name: { en: 'Thalerhof approach caution', de: 'Anflugbereich Thalerhof' },
    detail: {
      en: 'The club warns that the Thalerhof approach begins above the launch in stronger southerly wind. Verify current official airspace and altitude limits.',
      de: 'Der Club warnt, dass bei stärkerem Südwind über dem Startplatz der Anflugbereich Thalerhof beginnt. Aktuelle amtliche Luftraum- und Höhenlimits prüfen.',
    },
    latitude: 47.3032985,
    longitude: 15.4802163,
    source: {
      label: { en: 'Paragleitclub Steiermark — Gelderkogel rules', de: 'Paragleitclub Steiermark — Gelderkogel-Regeln' },
      url: 'https://www.paragleitclub-steiermark.at/wp/fluggebiet-gelderkogel/',
    },
  },
] as const

export const geosphereWarningsUrl = 'https://warnungen.zamg.at/'
export const austroControlPreflightUrl =
  'https://www.austrocontrol.at/en/pilots/pre-flight_preparation'

export const siteIds = ['schoeckl', 'gelderkogel'] as const
