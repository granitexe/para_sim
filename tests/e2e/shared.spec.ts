import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { installProviderMocks } from './providerMocks'

test('weather sources remain separate and site station policy is explicit', async ({ page }) => {
  const providers = await installProviderMocks(page)
  await page.goto('/#weather')

  await expect(page.getByRole('heading', { name: 'SCHOECKL · 11241' })).toBeVisible()
  await expect(page.getByText('No official GeoSphere warning was returned for this municipality at the last check.')).toBeVisible()
  await expect(page.getByText('GeoSphere nowcast-v1-15min-1km')).toBeVisible()
  await expect(page.getByText('GeoSphere nwp-v1-1h-2500m')).toBeVisible()
  await expect(page.getByText('DWD ICON-D2 via Open-Meteo')).toBeVisible()
  await expect(page.getByText('Model run time unavailable from this response')).toBeVisible()
  await expect(page.getByText('850 hPa')).toBeVisible()
  await expect(page.getByText('No thermal strength, cloud base, lift rate, rotor flow, or flyability score is calculated.')).toBeVisible()
  await expect(page.getByText('Station measurement (ring)')).toBeVisible()
  await expect(page.getByText('GeoSphere model grid (high contrast)')).toBeVisible()
  await expect(page.getByText(/4 grid points: 3 arrows, 1 calm, 0 missing · valid/)).toBeVisible()
  await expect(page.getByText('Model values are independent gridded guidance, not station interpolation.')).toBeVisible()
  await expect(page.getByRole('img', { name: 'Compass: needle points north' })).toBeVisible()
  const windFieldRequest = providers.requests.find((request) =>
    request.url.includes('/grid/forecast/nwp-v1-1h-2500m'),
  )
  expect(windFieldRequest).toBeDefined()
  const windFieldUrl = new URL(windFieldRequest!.url)
  expect(windFieldUrl.searchParams.getAll('parameters')).toEqual(['u10m', 'v10m'])
  expect(windFieldUrl.searchParams.get('bbox')).toBe('47.1,15.35,47.4,15.65')
  expect(windFieldUrl.searchParams.get('start')).toBe(windFieldUrl.searchParams.get('end'))

  const warningTop = await page.getByRole('heading', { name: 'Official warnings' }).evaluate((element) => element.getBoundingClientRect().top)
  const nowcastTop = await page.getByRole('heading', { name: 'Short-term surface guidance' }).evaluate((element) => element.getBoundingClientRect().top)
  expect(warningTop).toBeLessThan(nowcastTop)

  await page.getByRole('button', { name: 'Gelderkogel' }).click()
  await expect(page.getByText('No active local weather station is available at Gelderkogel. Values below are model guidance for the peak, not launch-site measurements.')).toBeVisible()
  await expect(page.getByText('GRAZ REGIONAL')).toBeVisible()
  await page.getByRole('button', { name: /GRAZ REGIONAL/ }).click()
  await expect(page.getByRole('heading', { name: 'GRAZ REGIONAL · 12345' })).toBeVisible()
  await expect(page.getByText('Regional point context only')).toBeVisible()
  const refresh = page.getByRole('button', { name: 'Refresh' })
  await refresh.click()
  await expect(refresh).toBeDisabled()
  await expect(page.locator('#refresh-status')).toContainText('Refresh available in')
  expect(providers.unexpected).toEqual([])
})

test('weather marker layers can be hidden independently', async ({ page }) => {
  const providers = await installProviderMocks(page)
  await page.goto('/#weather')
  await expect(page.getByText('GeoSphere model grid (high contrast)')).toBeVisible()

  const controls = page.locator('.weather-layer-controls')
  await controls.locator('summary').click()
  const windGrid = controls.getByLabel('Regional wind grid')
  const stations = controls.getByLabel('Station observations')
  const sites = controls.getByLabel('Weather sites')
  const takeoffs = controls.getByLabel('Takeoffs')
  const landings = controls.getByLabel('Landings')
  const restrictions = controls.getByLabel('Restrictions')
  for (const checkbox of [windGrid, stations, sites, takeoffs, landings, restrictions]) {
    await expect(checkbox).toBeChecked()
  }

  const map = page.locator('.weather-map .map-panel')
  const visibleMarkers = await map.screenshot()
  await windGrid.uncheck()
  const hiddenGrid = await map.screenshot()
  expect(visibleMarkers.equals(hiddenGrid)).toBe(false)
  await stations.uncheck()
  await sites.uncheck()
  await takeoffs.uncheck()
  await landings.uncheck()
  await restrictions.uncheck()
  for (const checkbox of [windGrid, stations, sites, takeoffs, landings, restrictions]) {
    await expect(checkbox).not.toBeChecked()
  }
  expect(providers.unexpected).toEqual([])
})

test('official warning and automated thunderstorm text remain sourced in both languages', async ({ page }) => {
  const providers = await installProviderMocks(page, { warning: true, thunderstorm: true })
  await page.goto('/#weather')

  await expect(page.getByText('Official thunderstorm text')).toBeVisible()
  await expect(page.getByText('Official effects')).toBeVisible()
  await expect(page.getByText('Official recommendation')).toBeVisible()
  await expect(page.getByText('An automated official thunderstorm warning is active.')).toBeVisible()
  await expect(page.getByText('Unmodified provider intensity: provider-raw-7')).toBeVisible()

  await page.getByLabel('Language').selectOption('de')
  await expect(page.locator('html')).toHaveAttribute('lang', 'de')
  await expect(page.getByText('Amtlicher Gewittertext')).toBeVisible()
  await expect(page.getByText('Eine automatisierte amtliche Gewitterwarnung ist aktiv.')).toBeVisible()
  await expect(page.getByText('Nur Entscheidungshilfe. Bergwetter ändert sich schnell.', { exact: false })).toBeVisible()
  expect(providers.unexpected).toEqual([])
})

test('personal comparisons show equality and direction per source without an aggregate verdict', async ({ page }) => {
  const providers = await installProviderMocks(page)
  await page.goto('/#weather')
  await expect(page.getByRole('heading', { name: 'Comparison with your limits' })).toBeVisible()

  await page.getByRole('button', { name: 'Personal limits' }).click()
  const site = page.locator('.site-limit-fields').first()
  await site.locator('input[type="number"]').nth(0).fill('14.4')
  await site.locator('input[type="number"]').nth(1).fill('28.8')
  await site.locator('.sector-grid input[type="checkbox"]').first().check()
  await page.getByRole('button', { name: 'Save' }).click()

  const groups = page.locator('.comparison-group')
  await expect(groups).toHaveCount(3)
  const observation = groups.filter({ hasText: 'station 11241' })
  await expect(observation.locator('[data-comparison-status="at-or-under-entered-limit"]')).toHaveCount(2)
  await expect(observation.locator('[data-comparison-status="outside-selected-sector"]')).toHaveCount(1)
  await expect(observation.getByText('Exceeded/outside in this source: 1')).toBeVisible()
  await expect(groups.filter({ hasText: 'GeoSphere nowcast · model' })).toHaveCount(1)
  await expect(groups.filter({ hasText: 'GeoSphere NWP · model' })).toHaveCount(1)
  await expect(page.locator('.limit-comparisons')).not.toContainText('ICON')
  await expect(page.getByText('This compares data with limits you entered; it is not a safe-to-fly decision.')).toBeVisible()
  expect(providers.unexpected).toEqual([])
})

test('stale direct observation is viewable but not evaluated', async ({ page }) => {
  const providers = await installProviderMocks(page, { observationAgeMinutes: 21 })
  await page.goto('/#weather')
  await page.getByRole('button', { name: 'Personal limits' }).click()
  const site = page.locator('.site-limit-fields').first()
  await site.locator('input[type="number"]').nth(0).fill('14.4')
  await site.locator('input[type="number"]').nth(1).fill('28.8')
  await site.locator('.sector-grid input[type="checkbox"]').first().check()
  await page.getByRole('button', { name: 'Save' }).click()

  const observation = page.locator('.comparison-group').filter({ hasText: 'station 11241' })
  await expect(observation.locator('[data-comparison-status="not-evaluated"]')).toHaveCount(3)
  await expect(page.getByRole('heading', { name: 'SCHOECKL · 11241' })).toBeVisible()
  expect(providers.unexpected).toEqual([])
})

test('presentation preferences persist while imported flight state does not', async ({ page }) => {
  const providers = await installProviderMocks(page)
  await page.goto('/#flight')
  await page.locator('input[type="file"]').setInputFiles('tests/e2e/fixtures/synthetic-flight.txt')
  await expect(page.getByRole('heading', { name: 'Flight summary' })).toBeVisible()
  await page.locator('#weather-tab').click()
  await expect(page.getByRole('heading', { name: 'SCHOECKL · 11241' })).toBeVisible()

  await page.getByRole('button', { name: 'Personal limits' }).click()
  await page.locator('dialog select').selectOption('mps')
  await page.locator('.site-limit-fields').first().locator('input[type="number"]').first().fill('12')
  await page.getByRole('button', { name: 'Save' }).click()
  await page.getByLabel('Language').selectOption('de')
  await expect(page.locator('html')).toHaveAttribute('lang', 'de')

  await page.reload()
  await page.getByRole('button', { name: 'Persönliche Grenzen' }).click()
  await expect(page.locator('dialog select')).toHaveValue('mps')
  await expect(page.locator('.site-limit-fields').first().locator('input[type="number"]').first()).toHaveValue('12')
  await page.keyboard.press('Escape')
  await page.locator('#flight-tab').click()
  await expect(page.getByRole('button', { name: 'IGC-Datei auswählen' })).toBeVisible()
  expect(providers.unexpected).toEqual([])
})

test('phone and desktop surfaces have accessible equivalents and navigation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const providers = await installProviderMocks(page)
  await page.goto('/#weather')
  await expect(page.getByRole('heading', { name: '24-hour station history' })).toBeVisible()

  const mobileAxe = await new AxeBuilder({ page }).analyze()
  expect(mobileAxe.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? ''))).toEqual([])
  const mobileLayout = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
    mapHeight: document.querySelector('.weather-map .map-panel')?.getBoundingClientRect().height ?? 0,
    smallControls: [...document.querySelectorAll('button, select, input[type="range"]')].filter((element) => {
      const box = element.getBoundingClientRect()
      return box.width > 0 && box.height > 0 && (box.width < 44 || box.height < 44)
    }).length,
  }))
  expect(mobileLayout.width).toBe(mobileLayout.viewport)
  expect(mobileLayout.mapHeight).toBeGreaterThanOrEqual(320)
  expect(mobileLayout.smallControls).toBe(0)

  await page.getByRole('button', { name: 'Collapse details' }).click()
  await expect(page.getByText('Decision aid only. Mountain weather changes rapidly.', { exact: false })).toBeVisible()
  await page.locator('#weather-tab').focus()
  await page.keyboard.press('ArrowLeft')
  await expect(page).toHaveURL(/#flight$/u)
  await expect(page.locator('#flight-tab')).toBeFocused()
  await page.goBack()
  await expect(page).toHaveURL(/#weather$/u)

  await page.setViewportSize({ width: 1440, height: 900 })
  const desktop = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
    columns: [...document.querySelectorAll('.weather-map, .detail-panel')].map((element) => element.getBoundingClientRect().width),
  }))
  expect(desktop.width).toBe(desktop.viewport)
  expect(desktop.columns[0]).toBeGreaterThan(desktop.columns[1] ?? 0)
  expect(providers.unexpected).toEqual([])
})
