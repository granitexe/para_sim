import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { installProviderMocks } from './providerMocks'


async function uploadSynthetic(page: Page, fixture = 'synthetic-flight.txt') {
  await page.locator('input[type="file"]').setInputFiles(`tests/e2e/fixtures/${fixture}`)
}

test('private replay never sends flight data and resets consent', async ({ page }) => {
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
  expect(providers.requests.filter((request) => request.url.includes('api.maptiler.com'))).toEqual([])

  await page.getByLabel('Playback speed').selectOption('10')
  await page.getByRole('button', { name: 'Play' }).click()
  await expect(page.locator('.playback-time')).toContainText('Elapsed: 0:05', { timeout: 10_000 })
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible()
  await page.getByLabel('Follow marker').check()
  await page.getByRole('button', { name: 'Reset view' }).click()
  await page.getByLabel('Flight progress').fill(String(Date.UTC(2026, 0, 1, 12, 0, 2)))
  await expect(page.locator('.playback-time')).toContainText('0:02')

  await page.getByRole('button', { name: 'Load online satellite & terrain' }).click()
  await expect(page.getByText('Satellite imagery and 3D terrain are unavailable; configure or check the MapTiler browser key.')).toBeVisible()
  expect(providers.requests.filter((request) => request.url.includes('api.maptiler.com'))).toEqual([])

  await uploadSynthetic(page)
  await expect(page.getByText('Private map mode is on.', { exact: false })).toBeVisible()
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

test('2D fallback keeps time replay and labels altitude unavailable', async ({ page }) => {
  await installProviderMocks(page)
  await page.goto('/#flight')
  await uploadSynthetic(page, 'synthetic-no-altitude.txt')

  await expect(page.getByText('2D terrain-draped flight track')).toBeVisible()
  await expect(page.getByText('No source altitude; 2D terrain-draped')).toBeVisible()
  await expect(page.getByText('Current source altitude').locator('..')).toContainText('—')
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
})
