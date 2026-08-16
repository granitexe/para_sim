import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { installProviderMocks } from './providerMocks'


async function uploadSynthetic(page: Page, fixture = 'synthetic-flight.txt') {
  await page.locator('input[type="file"]').setInputFiles(`tests/e2e/fixtures/${fixture}`)
}

test('private replay never sends flight data and resets local state', async ({ page }) => {
  const providers = await installProviderMocks(page)
  const requests: Array<{ url: string; method: string; postData: string | null }> = []
  page.on('request', (request) => {
    requests.push({ url: request.url(), method: request.method(), postData: request.postData() })
  })
  await page.goto('/#flight')
  await uploadSynthetic(page)

  await expect(page.getByRole('heading', { name: 'Flight summary' })).toBeVisible()
  await expect(page.getByText('Synthetic ridge')).toBeVisible()
  await expect(page.getByText('Usable fixes').locator('..')).toContainText('6')
  await expect(page.getByText('Private Pilot Must Not Appear')).toHaveCount(0)
  await expect(page.getByText('Private Device Must Not Appear')).toHaveCount(0)
  await expect(page.locator('.cesium-container canvas')).toBeVisible()
  expect(
    providers.requests.filter((request) =>
      /opentopomap|newaydata|maptiler/u.test(request.url),
    ),
  ).toEqual([])

  await page.getByLabel('Playback speed').selectOption('10')
  await page.getByRole('button', { name: 'Play' }).click()
  await expect(page.locator('.playback-time')).toContainText('Elapsed: 0:05', { timeout: 10_000 })
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible()
  await page.getByLabel('Follow marker').check()
  await page.getByRole('button', { name: 'Reset view' }).click()
  await page.getByLabel('Flight progress').fill(String(Date.UTC(2026, 0, 1, 12, 0, 2)))
  await expect(page.locator('.playback-time')).toContainText('0:02')

  await page.getByRole('button', { name: 'Remove flight' }).click()
  await expect(page.getByRole('button', { name: 'Choose an IGC file' })).toBeVisible()
  await expect(page.locator('.cesium-container canvas')).toHaveCount(0)

  await uploadSynthetic(page)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Choose an IGC file' })).toBeVisible()
  expect(requests.some((request) => request.url.includes('synthetic-flight.txt'))).toBe(false)
  expect(requests.some((request) => request.url.includes('Synthetic%20ridge'))).toBe(false)
  expect(requests.some((request) => request.postData?.includes('B120000') ?? false)).toBe(false)
  expect(providers.unexpected).toEqual([])
})

test('open map choices send only tile coordinates and reset on replacement', async ({ page }) => {
  test.slow()
  const providers = await installProviderMocks(page)
  const mapRequestsAfterReset: string[] = []
  let collectMapRequestsAfterReset = false
  page.on('request', (request) => {
    if (
      collectMapRequestsAfterReset &&
      /opentopomap|newaydata|maptiler/u.test(request.url())
    ) {
      mapRequestsAfterReset.push(request.url())
    }
  })
  await page.goto('/#flight')
  await uploadSynthetic(page)

  await expect(page.locator('.cesium-container canvas')).toBeVisible()
  await page.getByRole('button', { name: 'Map controls' }).click()
  const markerControls = page.locator('.replay-map .map-control-popover')
  const restrictionGroup = markerControls.locator(
    '[data-map-control-group="restrictions"]',
  )
  await restrictionGroup.locator('summary').click()
  const restriction = restrictionGroup.getByLabel('Graz controlled-airspace caution')
  await expect(restriction).toBeChecked()
  await restriction.uncheck()
  await expect(restriction).not.toBeChecked()
  await restriction.check()
  await expect(page.getByRole('button', { name: 'Private overview' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Open topographic map' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Aviation chart' })).toBeVisible()
  await page.getByText('Mapped takeoff, landing, and restriction notices').click()
  await expect(page.getByText('Schöckl southeast takeoff')).toBeVisible()
  await expect(page.getByText('Gelderkogel training landing')).toBeVisible()
  await expect(page.getByText('Graz controlled-airspace caution:', { exact: false })).toBeVisible()
  expect(
    providers.requests.filter((request) =>
      /opentopomap|newaydata|maptiler/u.test(request.url),
    ),
  ).toEqual([])

  await page.getByRole('button', { name: 'Open topographic map' }).click()
  await expect(page.getByText('OpenTopoMap receives tile coordinates', { exact: false })).toBeVisible()
  await expect.poll(() =>
    providers.requests.some((request) => request.url.includes('.tile.opentopomap.org/')),
  ).toBe(true)
  const replayCanvas = await page.locator('.cesium-container canvas').elementHandle()
  expect(replayCanvas).not.toBeNull()
  await page.getByLabel('Playback speed').selectOption('1')
  await page.getByRole('button', { name: 'Play' }).click()
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()
  await page.getByRole('button', { name: 'Aviation chart' }).click()
  await expect(page.getByText('OpenFlightMaps receives tile coordinates', { exact: false })).toBeVisible()
  await expect.poll(() =>
    providers.requests.some((request) => request.url.includes('nwy-tiles-api.prod.newaydata.com')),
  ).toBe(true)
  expect(await replayCanvas!.evaluate((canvas) => canvas.isConnected)).toBe(true)
  await expect(page.locator('.playback-time')).toContainText('Elapsed: 0:05', {
    timeout: 10_000,
  })
  await expect(
    page.getByText(
      'The selected online map failed to load; the private bundled overview was restored.',
    ),
  ).toHaveCount(0)
  const externalMapRequests = providers.requests.filter((request) =>
    /opentopomap|newaydata|maptiler/u.test(request.url),
  )
  expect(externalMapRequests.every((request) => ['GET', 'HEAD'].includes(request.method))).toBe(true)
  expect(externalMapRequests.every((request) => request.postData === null)).toBe(true)
  expect(externalMapRequests.some((request) => /synthetic-flight|Synthetic%20ridge|B120000/u.test(request.url))).toBe(false)

  await page.waitForTimeout(1_000)
  await uploadSynthetic(page)
  await expect(page.getByText('Private overview is on.', { exact: false })).toBeVisible()
  collectMapRequestsAfterReset = true
  await page.waitForTimeout(1_000)
  expect(mapRequestsAfterReset).toEqual([])
  expect(providers.unexpected).toEqual([])
})

test('one failed aviation tile does not replace or tear down the map', async ({ page }) => {
  const providers = await installProviderMocks(page)
  let failedOneTile = false
  await page.route('**/nwy-tiles-api.prod.newaydata.com/**', async (route) => {
    if (!failedOneTile) {
      failedOneTile = true
      await route.fulfill({
        status: 503,
        contentType: 'text/plain',
        body: 'temporary tile failure',
      })
      return
    }
    await route.fallback()
  })

  await page.goto('/#weather')
  await expect(page.locator('.weather-map .cesium-container canvas')).toBeVisible()
  const canvas = await page.locator('.weather-map .cesium-container canvas').elementHandle()
  expect(canvas).not.toBeNull()
  await page.getByRole('button', { name: 'Aviation' }).click()
  await expect.poll(() => failedOneTile).toBe(true)
  await page.waitForTimeout(1_000)

  expect(await canvas!.evaluate((element) => element.isConnected)).toBe(true)
  await expect(
    page.getByText(
      'The selected online map failed to load; the private bundled overview was restored.',
    ),
  ).toHaveCount(0)
  expect(
    providers.requests.filter((request) =>
      request.url.includes('nwy-tiles-api.prod.newaydata.com'),
    ).length,
  ).toBeLessThan(100)
  expect(providers.unexpected).toEqual([])
})

test('2D replay keeps time playback when source altitude is unavailable', async ({ page }) => {
  await installProviderMocks(page)
  await page.goto('/#flight')
  await uploadSynthetic(page, 'synthetic-no-altitude.txt')

  await expect(page.getByText('2D flight track replay')).toBeVisible()
  await expect(page.getByText('No source altitude; 2D map replay')).toBeVisible()
  await expect(page.getByText('Current source altitude (data only)').locator('..')).toContainText('—')
  await page.getByRole('button', { name: 'Play' }).click()
  await expect(page.locator('.playback-time')).toContainText('0:05', { timeout: 10_000 })
})

test('flight import shell and replay have no serious accessibility violations', async ({ page }) => {
  await installProviderMocks(page)
  await page.goto('/#flight')
  let results = await new AxeBuilder({ page }).analyze()
  expect(results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? ''))).toEqual([])
  await uploadSynthetic(page)
  await expect(page.locator('.cesium-container canvas')).toBeVisible()
  results = await new AxeBuilder({ page }).analyze()
  expect(results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? ''))).toEqual([])
  await page.getByRole('button', { name: 'Map controls' }).click()
  results = await new AxeBuilder({ page }).analyze()
  expect(results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? ''))).toEqual([])
})
