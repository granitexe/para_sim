import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useWeatherData } from '../src/features/weather/useWeatherData'

const clients = vi.hoisted(() => ({
  getCurrent: vi.fn(),
  getNowcast: vi.fn(),
  getNwp: vi.fn(),
  getWindField: vi.fn(),
  getAloft: vi.fn(),
  getWarningResources: vi.fn(),
  getHistory: vi.fn(),
}))

vi.mock('../src/services/geosphereClient', () => ({
  geosphereClient: {
    getCurrent: clients.getCurrent,
    getNowcast: clients.getNowcast,
    getNwp: clients.getNwp,
    getWindField: clients.getWindField,
    getWarningResources: clients.getWarningResources,
    getHistory: clients.getHistory,
  },
}))

vi.mock('../src/services/openMeteoClient', () => ({
  openMeteoClient: {
    getAloft: clients.getAloft,
  },
}))

describe('weather resource orchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('publishes current station data without waiting for slow model sources', async () => {
    let resolveCurrent: ((value: { stations: []; observations: []; fetchedAtMs: number }) => void) | undefined
    const currentRequest = new Promise<{ stations: []; observations: []; fetchedAtMs: number }>(
      (resolve) => {
        resolveCurrent = resolve
      },
    )
    const pendingRequest = new Promise<never>(() => undefined)
    clients.getCurrent.mockReturnValue(currentRequest)
    clients.getNowcast.mockReturnValue(pendingRequest)
    clients.getNwp.mockReturnValue(pendingRequest)
    clients.getWindField.mockReturnValue(pendingRequest)
    clients.getAloft.mockReturnValue(pendingRequest)
    clients.getWarningResources.mockReturnValue(pendingRequest)
    clients.getHistory.mockReturnValue(pendingRequest)

    const { result } = renderHook(() =>
      useWeatherData({
        selectedSiteId: 'schoeckl',
        selectedStationId: '11241',
        locale: 'en',
      }),
    )

    expect(result.current.current.status).toBe('loading')
    expect(result.current.nwp.status).toBe('loading')
    resolveCurrent?.({ stations: [], observations: [], fetchedAtMs: 123 })

    await waitFor(() => expect(result.current.current.status).toBe('available'))
    expect(result.current.current).toMatchObject({ fetchedAtMs: 123 })
    expect(result.current.nwp.status).toBe('loading')
    expect(result.current.aloft.status).toBe('loading')
  })
})
