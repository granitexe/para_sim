import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { SiteId } from '../../domain/sites'
import type {
  AloftWindPoint,
  AutomatedThunderstormStatus,
  LoadState,
  OfficialWarning,
  RegionalWindField,
  SiteForecastPoint,
  SiteNowcastPoint,
  StationHistoryPoint,
} from '../../domain/weather'
import {
  geosphereClient,
  type OfficialWarningResult,
  type StationCurrentResult,
  type WarningResources,
} from '../../services/geosphereClient'
import { openMeteoClient } from '../../services/openMeteoClient'
import { WeatherClientError } from '../../services/weatherClientUtils'

const idle = { status: 'idle' } as const
const tenMinutesMs = 10 * 60 * 1_000
const oneHourMs = 60 * 60 * 1_000
const threeHoursMs = 3 * oneHourMs
const manualCooldownMs = 60 * 1_000

export interface WeatherResources {
  current: LoadState<StationCurrentResult>
  history: LoadState<StationHistoryPoint[]>
  nowcast: LoadState<Record<SiteId, SiteNowcastPoint[]>>
  nwp: LoadState<Record<SiteId, SiteForecastPoint[]>>
  windField: LoadState<RegionalWindField>
  aloft: LoadState<Record<SiteId, AloftWindPoint[]>>
  officialWarnings: LoadState<OfficialWarningResult>
  thunderstorm: LoadState<AutomatedThunderstormStatus>
}

interface UseWeatherDataOptions {
  selectedSiteId: SiteId
  selectedStationId: string | null
  locale: 'en' | 'de'
}

interface WeatherDataController extends WeatherResources {
  refresh: () => Promise<void>
  refreshing: boolean
  refreshAvailableAtMs: number
  nowMs: number
}

function unavailable<T>(error: unknown): LoadState<T> {
  const normalized =
    error instanceof WeatherClientError
      ? error
      : new WeatherClientError('fetch-failure', 'The weather resource could not be loaded.')
  return {
    status: 'unavailable',
    reason: normalized.reason,
    checkedAtMs: normalized.checkedAtMs,
    nextAllowedAtMs: normalized.nextAllowedAtMs,
    message: normalized.message,
  }
}

function loading<T>(state: LoadState<T>): LoadState<T> {
  return {
    status: 'loading',
    startedAtMs: Date.now(),
    previous: state.status === 'available' ? state.data : null,
  }
}

function available<T>(data: T, fetchedAtMs = Date.now()): LoadState<T> {
  return { status: 'available', data, fetchedAtMs, stale: false, dataWarnings: [] }
}

async function settleResource<T>(
  request: Promise<T>,
  shouldCommit: () => boolean,
  setState: Dispatch<SetStateAction<LoadState<T>>>,
  fetchedAtMs?: (data: T) => number,
): Promise<void> {
  try {
    const data = await request
    if (shouldCommit()) setState(available(data, fetchedAtMs?.(data)))
  } catch (error) {
    if (shouldCommit()) setState(unavailable(error))
  }
}

export function useWeatherData({
  selectedSiteId,
  selectedStationId,
  locale,
}: UseWeatherDataOptions): WeatherDataController {
  const [current, setCurrent] = useState<LoadState<StationCurrentResult>>(idle)
  const [history, setHistory] = useState<LoadState<StationHistoryPoint[]>>(idle)
  const [nowcast, setNowcast] = useState<LoadState<Record<SiteId, SiteNowcastPoint[]>>>(idle)
  const [nwp, setNwp] = useState<LoadState<Record<SiteId, SiteForecastPoint[]>>>(idle)
  const [windField, setWindField] = useState<LoadState<RegionalWindField>>(idle)
  const [aloft, setAloft] = useState<LoadState<Record<SiteId, AloftWindPoint[]>>>(idle)
  const [officialWarnings, setOfficialWarnings] = useState<LoadState<OfficialWarningResult>>(idle)
  const [thunderstorm, setThunderstorm] = useState<LoadState<AutomatedThunderstormStatus>>(idle)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshAvailableAtMs, setRefreshAvailableAtMs] = useState(0)
  const [nowMs, setNowMs] = useState(Date.now())
  const mounted = useRef(true)
  const modelAbort = useRef<AbortController | null>(null)
  const warningAbort = useRef<AbortController | null>(null)
  const historyAbort = useRef<AbortController | null>(null)

  const loadModels = useCallback(async (includeSlowModels: boolean) => {
    modelAbort.current?.abort()
    const controller = new AbortController()
    modelAbort.current = controller
    setCurrent((state) => loading(state))
    setNowcast((state) => loading(state))
    if (includeSlowModels) {
      setNwp((state) => loading(state))
      setWindField((state) => loading(state))
      setAloft((state) => loading(state))
    }

    const shouldCommit = () => mounted.current && !controller.signal.aborted
    const tasks: Promise<void>[] = [
      settleResource(
        geosphereClient.getCurrent(controller.signal),
        shouldCommit,
        setCurrent,
        (data) => data.fetchedAtMs,
      ),
      settleResource(
        geosphereClient.getNowcast(controller.signal),
        shouldCommit,
        setNowcast,
      ),
    ]
    if (includeSlowModels) {
      tasks.push(
        settleResource(
          geosphereClient.getNwp(controller.signal),
          shouldCommit,
          setNwp,
        ),
        settleResource(
          geosphereClient.getWindField(Date.now(), controller.signal),
          shouldCommit,
          setWindField,
          (data) => data.fetchedAtMs,
        ),
        settleResource(
          openMeteoClient.getAloft(controller.signal),
          shouldCommit,
          setAloft,
        ),
      )
    }
    await Promise.all(tasks)
  }, [])

  const loadWarnings = useCallback(async (siteId: SiteId, warningLocale: 'en' | 'de') => {
    warningAbort.current?.abort()
    const controller = new AbortController()
    warningAbort.current = controller
    setOfficialWarnings((state) => loading(state))
    setThunderstorm((state) => loading(state))
    let result: WarningResources
    try {
      result = await geosphereClient.getWarningResources(siteId, warningLocale, controller.signal)
    } catch (error) {
      if (!mounted.current || controller.signal.aborted) return
      setOfficialWarnings(unavailable(error))
      setThunderstorm(unavailable(error))
      return
    }
    if (!mounted.current || controller.signal.aborted) return
    setOfficialWarnings(result.official)
    setThunderstorm(result.thunderstorm)
  }, [])

  const loadHistory = useCallback(async (stationId: string | null) => {
    historyAbort.current?.abort()
    if (stationId === null) {
      setHistory(idle)
      return
    }
    const controller = new AbortController()
    historyAbort.current = controller
    setHistory((state) => loading(state))
    try {
      const points = await geosphereClient.getHistory(stationId, Date.now(), controller.signal)
      if (mounted.current && !controller.signal.aborted) setHistory(available(points))
    } catch (error) {
      if (mounted.current && !controller.signal.aborted) setHistory(unavailable(error))
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    void loadModels(true)
    const currentTimer = window.setInterval(() => void loadModels(false), tenMinutesMs)
    const nwpTimer = window.setInterval(async () => {
      const controller = new AbortController()
      const result = await Promise.allSettled([
        geosphereClient.getNwp(controller.signal),
        geosphereClient.getWindField(Date.now(), controller.signal),
      ])
      if (!mounted.current) return
      const nwpResult = result[0]!
      const windFieldResult = result[1]!
      setNwp(
        nwpResult.status === 'fulfilled'
          ? available(nwpResult.value)
          : unavailable(nwpResult.reason),
      )
      setWindField(
        windFieldResult.status === 'fulfilled'
          ? available(windFieldResult.value, windFieldResult.value.fetchedAtMs)
          : unavailable(windFieldResult.reason),
      )
    }, oneHourMs)
    const aloftTimer = window.setInterval(async () => {
      const result = await Promise.allSettled([openMeteoClient.getAloft()])
      if (!mounted.current) return
      const aloftResult = result[0]!
      setAloft(
        aloftResult.status === 'fulfilled'
          ? available(aloftResult.value)
          : unavailable(aloftResult.reason),
      )
    }, threeHoursMs)
    const clockTimer = window.setInterval(() => setNowMs(Date.now()), 1_000)
    return () => {
      mounted.current = false
      modelAbort.current?.abort()
      warningAbort.current?.abort()
      historyAbort.current?.abort()
      window.clearInterval(currentTimer)
      window.clearInterval(nwpTimer)
      window.clearInterval(aloftTimer)
      window.clearInterval(clockTimer)
    }
  }, [loadModels])

  useEffect(() => {
    void loadWarnings(selectedSiteId, locale)
    const timer = window.setInterval(
      () => void loadWarnings(selectedSiteId, locale),
      tenMinutesMs,
    )
    return () => {
      window.clearInterval(timer)
      warningAbort.current?.abort()
    }
  }, [loadWarnings, locale, selectedSiteId])

  useEffect(() => {
    void loadHistory(selectedStationId)
    return () => historyAbort.current?.abort()
  }, [loadHistory, selectedStationId])

  const refresh = useCallback(async () => {
    const startedAtMs = Date.now()
    if (refreshing || startedAtMs < refreshAvailableAtMs) return
    setRefreshing(true)
    setRefreshAvailableAtMs(startedAtMs + manualCooldownMs)
    geosphereClient.invalidateCurrent()
    geosphereClient.invalidateNowcast()
    geosphereClient.invalidateNwp()
    geosphereClient.invalidateWindField()
    geosphereClient.invalidateWarnings(selectedSiteId, locale)
    openMeteoClient.invalidate()
    if (selectedStationId !== null) geosphereClient.invalidateHistory(selectedStationId)

    await Promise.allSettled([
      loadModels(true),
      loadWarnings(selectedSiteId, locale),
      loadHistory(selectedStationId),
    ])
    if (mounted.current) {
      setNowMs(Date.now())
      setRefreshing(false)
    }
  }, [
    loadHistory,
    loadModels,
    loadWarnings,
    locale,
    refreshAvailableAtMs,
    refreshing,
    selectedSiteId,
    selectedStationId,
  ])

  return {
    current,
    history,
    nowcast,
    nwp,
    windField,
    aloft,
    officialWarnings,
    thunderstorm,
    refresh,
    refreshing,
    refreshAvailableAtMs,
    nowMs,
  }
}
