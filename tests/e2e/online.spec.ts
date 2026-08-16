import { expect, test, type Page } from '@playwright/test'
import { installProviderMocks } from './providerMocks'


async function upload(page: Page) {
  await page.locator('input[type="file"]').setInputFiles('tests/e2e/fixtures/synthetic-flight.txt')
}

async function requireOnlineBuild(page: Page) {
  const satelliteButton = page.getByRole('button', { name: 'Satellite map' })
  test.skip(
    (await satelliteButton.count()) === 0,
    'Online project requires a build with a public dummy MapTiler key.',
  )
}

test('explicit consent loads only public tile coordinates and keeps flight payload local', async ({ page }) => {
  const providers = await installProviderMocks(page)
  const mapRequestsAfterReset: string[] = []
  let collectMapRequestsAfterReset = false
  page.on('request', (request) => {
    if (collectMapRequestsAfterReset && request.url().includes('api.maptiler.com')) {
      mapRequestsAfterReset.push(request.url())
    }
  })
  await page.goto('/#flight')
  await upload(page)
  await expect(page.getByText('Private overview is on.', { exact: false })).toBeVisible()
  await requireOnlineBuild(page)
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth === window.innerWidth),
  ).toBe(true)
  await page.getByRole('button', { name: 'Satellite map' }).click()
  await expect(page.getByText('MapTiler receives tile coordinates', { exact: false })).toBeVisible()
  await expect.poll(() => providers.requests.some((request) => request.url.includes('/maps/satellite-v4/'))).toBe(true)

  const mapRequests = providers.requests.filter((request) => request.url.includes('api.maptiler.com'))
  expect(mapRequests.some((request) => request.url.includes('/maps/satellite-v4/'))).toBe(true)
  expect(mapRequests.some((request) => request.url.includes('/tiles/terrain-quantized-mesh-v2/'))).toBe(false)
  expect(mapRequests.every((request) => ['GET', 'HEAD'].includes(request.method))).toBe(true)
  expect(mapRequests.every((request) => request.postData === null)).toBe(true)
  expect(mapRequests.some((request) => /synthetic-flight|Synthetic%20ridge|B120000/u.test(request.url))).toBe(false)

  await page.waitForTimeout(500)
  await upload(page)
  await expect(page.getByText('Private overview is on.', { exact: false })).toBeVisible()
  collectMapRequestsAfterReset = true
  await page.waitForTimeout(1_000)
  expect(mapRequestsAfterReset).toEqual([])
  expect(providers.unexpected).toEqual([])
})

test('imagery failure atomically degrades the online viewer to bundled providers', async ({ page }) => {
  const providers = await installProviderMocks(page)
  await page.route('**/maps/satellite-v4/**', async (route) => {
    await route.fulfill({ status: 401, contentType: 'text/plain', body: 'mock auth failure' })
  })
  const sameOriginRequests: string[] = []
  page.on('request', (request) => {
    if (request.url().startsWith('http://127.0.0.1:4173')) sameOriginRequests.push(request.url())
  })
  await page.goto('/#flight')
  await upload(page)
  await requireOnlineBuild(page)
  await page.getByRole('button', { name: 'Satellite map' }).click()
  await expect(page.getByText('The selected online map failed to load; the private bundled overview was restored.')).toBeVisible({ timeout: 20_000 })
  await expect.poll(() => sameOriginRequests.some((url) => url.includes('/cesium/Assets/Textures/NaturalEarthII/'))).toBe(true)
  expect(providers.requests.some((request) => request.url.includes('/tiles/terrain-quantized-mesh-v2/'))).toBe(false)
  expect(providers.unexpected).toEqual([])
})
