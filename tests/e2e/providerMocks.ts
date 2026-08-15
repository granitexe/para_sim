import type { Page, Route } from '@playwright/test'

export interface ProviderMockOptions {
  observationAgeMinutes?: number
  warning?: boolean
  thunderstorm?: boolean
}

export interface CapturedRequest {
  url: string
  method: string
  postData: string | null
}

export interface ProviderMockState {
  requests: CapturedRequest[]
  unexpected: string[]
}

const transparentPixel = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'

function parameterData(parameters: Record<string, Array<number | null>>) {
  return Object.fromEntries(
    Object.entries(parameters).map(([name, data]) => [name, { name, unit: '', data }]),
  )
}

function feature(
  longitude: number,
  latitude: number,
  parameters: Record<string, Array<number | null>>,
  station?: string,
) {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [longitude, latitude] },
    properties: {
      parameters: parameterData(parameters),
      ...(station === undefined ? {} : { station }),
    },
  }
}

function json(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

export async function installProviderMocks(
  page: Page,
  options: ProviderMockOptions = {},
): Promise<ProviderMockState> {
  const state: ProviderMockState = { requests: [], unexpected: [] }
  const now = Date.now()
  const observationTime = now - (options.observationAgeMinutes ?? 5) * 60_000
  const validFrom = new Date(now - 24 * 60 * 60_000).toISOString()
  const validTo = new Date(now + 365 * 24 * 60 * 60_000).toISOString()
  const quarterHour = Math.floor(now / (15 * 60_000)) * 15 * 60_000
  const hour = Math.floor(now / (60 * 60_000)) * 60 * 60_000
  const iso = (timestamp: number) => new Date(timestamp).toISOString()

  await page.route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin === 'http://127.0.0.1:4173') {
      await route.continue()
      return
    }
    state.requests.push({
      url: request.url(),
      method: request.method(),
      postData: request.postData(),
    })

    if (url.hostname === 'api.maptiler.com') {
      if (url.pathname.includes('/maps/satellite-v4/')) {
        await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: transparentPixel })
        return
      }
      if (url.pathname.endsWith('/layer.json')) {
        await json(route, {
          tilejson: '2.1.0',
          format: 'heightmap-1.0',
          version: '1.0.0',
          scheme: 'tms',
          projection: 'EPSG:4326',
          tiles: ['{z}/{x}/{y}.terrain?v={version}'],
          minzoom: 0,
          maxzoom: 0,
          bounds: [-180, -90, 180, 90],
          attribution: 'MapTiler terrain',
        })
        return
      }
      if (url.pathname.includes('/tiles/terrain-quantized-mesh-v2/')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/octet-stream',
          body: '\0'.repeat(65 * 65 * 2 + 2),
        })
        return
      }
      state.unexpected.push(request.url())
      await route.abort()
      return
    }

    if (url.hostname === 'dataset.api.hub.geosphere.at') {
      if (url.pathname.endsWith('/metadata')) {
        await json(route, {
          title: 'TAWES',
          time: iso(observationTime),
          stations: [
            {
              id: '11241',
              name: 'SCHOECKL',
              state: 'Steiermark',
              lat: 47.1986111111,
              lon: 15.4663888889,
              altitude: 1443,
              valid_from: validFrom,
              valid_to: validTo,
            },
            {
              id: '12345',
              name: 'GRAZ REGIONAL',
              state: 'Steiermark',
              lat: 47.12,
              lon: 15.44,
              altitude: 360,
              valid_from: validFrom,
              valid_to: validTo,
            },
          ],
        })
        return
      }
      if (url.pathname.includes('/station/current/')) {
        await json(route, {
          type: 'FeatureCollection',
          timestamps: [iso(observationTime)],
          features: [
            feature(15.4663888889, 47.1986111111, {
              DD: [180], DDX: [190], FFAM: [4], FFX: [8], TL: [10], TP: [4], RF: [50], P: [850], RR: [0],
            }, '11241'),
            feature(15.44, 47.12, {
              DD: [90], DDX: [100], FFAM: [2], FFX: [4], TL: [15], TP: [8], RF: [60], P: [970], RR: [null],
            }, '12345'),
          ],
        })
        return
      }
      if (url.pathname.includes('/station/historical/')) {
        const stationId = url.searchParams.get('station_ids') ?? '11241'
        const timestamps = [hour - 2 * 60 * 60_000, hour - 60 * 60_000, hour]
        await json(route, {
          type: 'FeatureCollection',
          timestamps: timestamps.map(iso),
          features: [
            feature(15.466, 47.198, {
              DD: [170, null, 180], DDX: [180, null, 190], FFAM: [3, null, 4], FFX: [6, null, 8], TL: [9, 9.5, 10], TP: [3, 3.5, 4], RF: [52, 51, 50], P: [850, 850, 850], RR: [0, null, 0],
            }, stationId),
          ],
        })
        return
      }
      if (url.pathname.includes('/nowcast-v1-15min-1km')) {
        const timestamps = [quarterHour, quarterHour + 15 * 60_000, quarterHour + 30 * 60_000]
        await json(route, {
          type: 'FeatureCollection',
          reference_time: iso(now - 10 * 60_000),
          timestamps: timestamps.map(iso),
          features: [
            feature(15.47159, 47.20056, { dd: [180, 180, 180], ff: [4, 4, 4], fx: [8, 8, 8], rh2m: [50, 50, 50], rr: [0, 0, 0], t2m: [10, 10, 10], td: [4, 4, 4] }),
            feature(15.47595, 47.30849, { dd: [170, 170, 170], ff: [3, 3, 3], fx: [6, 6, 6], rh2m: [55, 55, 55], rr: [0, 0, 0], t2m: [12, 12, 12], td: [5, 5, 5] }),
          ],
        })
        return
      }
      if (url.pathname.includes('/nwp-v1-1h-2500m')) {
        const timestamps = [hour, hour + 60 * 60_000, hour + 2 * 60 * 60_000]
        const parameters = {
          cape: [100, 200, 300], cin: [-5, -4, -3], grad: [0, 360000, 720000], rh2m: [50, 51, 52], rr_acc: [0, 1, 2], snowlmt: [2000, 2100, 2200], sp: [85000, 85100, 85200], t2m: [10, 11, 12], tcc: [0.5, 0.6, 0.7], u10m: [3, 3, 3], ugust: [6, 6, 6], v10m: [4, 4, 4], vgust: [8, 8, 8],
        }
        await json(route, {
          type: 'FeatureCollection',
          reference_time: iso(now - 60 * 60_000),
          timestamps: timestamps.map(iso),
          features: [
            feature(15.466, 47.193, parameters),
            feature(15.48, 47.31, parameters),
          ],
        })
        return
      }
      state.unexpected.push(request.url())
      await route.abort()
      return
    }

    if (url.hostname === 'warnungen.zamg.at') {
      if (url.pathname.endsWith('/getWarningsForCoords')) {
        const warningStart = Math.floor((now - 10 * 60_000) / 1000)
        const warnings = options.warning
          ? [{
              type: 'Warning',
              properties: {
                warntypid: 5,
                warnstufeid: 2,
                begin: 'provider begin',
                end: 'provider end',
                text: url.searchParams.get('lang') === 'de' ? 'Amtlicher Gewittertext' : 'Official thunderstorm text',
                auswirkungen: url.searchParams.get('lang') === 'de' ? 'Amtliche Auswirkungen' : 'Official effects',
                empfehlungen: url.searchParams.get('lang') === 'de' ? 'Amtliche Empfehlung' : 'Official recommendation',
                rawinfo: { wtype: 5, wlevel: 2, start: String(warningStart), end: String(warningStart + 3600) },
              },
            }]
          : []
        await json(route, {
          type: 'Feature',
          geometry: { type: 'MultiPolygon', coordinates: [] },
          properties: {
            location: { type: 'Municipal', properties: { gemeindenr: 60642, name: 'Mock municipality' } },
            warnings,
          },
        })
        return
      }
      if (url.pathname.endsWith('/getGewitterAuto')) {
        await json(route, {
          type: 'FeatureCollection',
          features: options.thunderstorm
            ? [{ type: 'Feature', properties: { gemeinde: 60642, intensity: 'provider-raw-7' } }]
            : [],
        })
        return
      }
      state.unexpected.push(request.url())
      await route.abort()
      return
    }

    if (url.hostname === 'api.open-meteo.com' && url.pathname === '/v1/dwd-icon') {
      const times = [hour, hour + 60 * 60_000, hour + 2 * 60 * 60_000]
      const location = (latitude: number, longitude: number, elevation: number) => ({
        latitude,
        longitude,
        elevation,
        timezone: 'GMT',
        hourly: {
          time: times.map((time) => iso(time).slice(0, 16)),
          wind_speed_850hPa: [4, 4, 4], wind_direction_850hPa: [180, 180, 180], geopotential_height_850hPa: [1550, 1550, 1550],
          wind_speed_800hPa: [5, 5, 5], wind_direction_800hPa: [190, 190, 190], geopotential_height_800hPa: [2000, 2000, 2000],
          wind_speed_700hPa: [6, 6, 6], wind_direction_700hPa: [200, 200, 200], geopotential_height_700hPa: [3000, 3000, 3000],
        },
      })
      await json(route, [
        location(47.2, 15.46, 1443),
        location(47.31, 15.48, 1195),
      ])
      return
    }

    state.unexpected.push(request.url())
    await route.abort()
  })
  return state
}
