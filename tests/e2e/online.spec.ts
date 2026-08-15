import { expect, test, type Page } from '@playwright/test'
import { installProviderMocks } from './providerMocks'


async function upload(page: Page) {
  await page.locator('input[type="file"]').setInputFiles('tests/e2e/fixtures/synthetic-flight.txt')
}

async function requireOnlineBuild(page: Page) {
  const unavailable = page.getByText(
    'Satellite imagery and 3D terrain are unavailable; configure or check the MapTiler browser key.',
  )
  await Promise.race([
    page.getByText('Online map mode is on for this flight session.', { exact: false }).waitFor(),
    unavailable.waitFor(),
  ])
  test.skip(await unavailable.isVisible(), 'Online project requires a build with the public dummy key.')
}

test('explicit consent loads only public tile coordinates and keeps flight payload local', async ({ page }) => {
  const providers = await installProviderMocks(page)
  await page.goto('/#flight')
  await upload(page)
  await expect(page.getByText('Private map mode is on.', { exact: false })).toBeVisible()

  await page.getByRole('button', { name: 'Load online satellite & terrain' }).click()
  await requireOnlineBuild(page)
  await expect(page.getByText('Online map mode is on for this flight session.', { exact: false })).toBeVisible()
  await expect.poll(() => providers.requests.some((request) => request.url.includes('/maps/satellite-v4/'))).toBe(true)
  await expect.poll(() => providers.requests.some((request) => request.url.includes('/tiles/terrain-quantized-mesh-v2/') && request.url.includes('layer.json'))).toBe(true)

  const mapRequests = providers.requests.filter((request) => request.url.includes('api.maptiler.com'))
  expect(mapRequests.some((request) => request.url.includes('/maps/satellite-v4/'))).toBe(true)
  expect(mapRequests.some((request) => request.url.includes('/tiles/terrain-quantized-mesh-v2/') && request.url.includes('layer.json'))).toBe(true)
  expect(mapRequests.every((request) => ['GET', 'HEAD'].includes(request.method))).toBe(true)
  expect(mapRequests.every((request) => request.postData === null)).toBe(true)
  expect(mapRequests.some((request) => /synthetic-flight|Synthetic%20ridge|B120000/u.test(request.url))).toBe(false)

  await page.waitForTimeout(500)
  const beforeReplacement = providers.requests.filter((request) => request.url.includes('api.maptiler.com')).length
  await upload(page)
  await expect(page.getByText('Private map mode is on.', { exact: false })).toBeVisible()
  await page.waitForTimeout(500)
  expect(providers.requests.filter((request) => request.url.includes('api.maptiler.com')).length).toBe(beforeReplacement)
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
  await page.getByRole('button', { name: 'Load online satellite & terrain' }).click()
  await requireOnlineBuild(page)

  await expect(page.getByText('Satellite imagery and 3D terrain are unavailable; configure or check the MapTiler browser key.')).toBeVisible({ timeout: 20_000 })
  await expect.poll(() => sameOriginRequests.some((url) => url.includes('/cesium/Assets/Textures/NaturalEarthII/'))).toBe(true)
  expect(providers.requests.some((request) => request.url.includes('/tiles/terrain-quantized-mesh-v2/'))).toBe(true)
  expect(providers.unexpected).toEqual([])
})
