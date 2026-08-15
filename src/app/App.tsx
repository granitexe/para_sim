import { lazy, Suspense, useEffect, useState, type KeyboardEvent } from 'react'
import type { Flight } from '../domain/flight'
import type { SiteId } from '../domain/sites'
import { loadPreferences, savePreferences, type PreferencesV1 } from '../domain/limits'
import { I18nProvider, useI18n } from '../i18n/I18nProvider'

const LazyFlightPage = lazy(() =>
  import('../features/flight/FlightPage').then((module) => ({ default: module.FlightPage })),
)
const LazyWeatherPage = lazy(() =>
  import('../features/weather/WeatherPage').then((module) => ({ default: module.WeatherPage })),
)


type ActiveTab = 'flight' | 'weather'

function tabFromHash(): ActiveTab {
  return window.location.hash === '#weather' ? 'weather' : 'flight'
}

function AppContent({
  preferences,
  setPreferences,
}: {
  preferences: PreferencesV1
  setPreferences: (preferences: PreferencesV1) => void
}) {
  const { t } = useI18n()
  const [activeTab, setActiveTab] = useState<ActiveTab>(tabFromHash)
  const [flight, setFlight] = useState<Flight | null>(null)
  const [onlineFlightMapEnabled, setOnlineFlightMapEnabled] = useState(false)
  const [activeWeatherSite, setActiveWeatherSite] = useState<SiteId>('schoeckl')
  const [activeStationId, setActiveStationId] = useState<string | null>('11241')
  const [isOnline, setIsOnline] = useState(navigator.onLine)

  useEffect(() => {
    if (window.location.hash !== '#flight' && window.location.hash !== '#weather') {
      window.history.replaceState(null, '', '#flight')
      setActiveTab('flight')
    }
    const handleHashChange = () => {
      if (window.location.hash !== '#flight' && window.location.hash !== '#weather') {
        window.history.replaceState(null, '', '#flight')
      }
      setActiveTab(tabFromHash())
    }
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  const activateTab = (tab: ActiveTab) => {
    if (window.location.hash !== `#${tab}`) window.location.hash = tab
    else setActiveTab(tab)
  }

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const tab: ActiveTab =
      event.key === 'ArrowLeft' || event.key === 'Home' ? 'flight' : 'weather'
    activateTab(tab)
    window.requestAnimationFrame(() => document.getElementById(`${tab}-tab`)?.focus())
  }

  const updatePreferences = (next: PreferencesV1) => {
    setPreferences(next)
    savePreferences(next)
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <a className="brand" href="#flight" onClick={() => activateTab('flight')}>
          {t('appName')}
        </a>
        <div className="header-controls">
          <label>
            <span className="sr-only">{t('language')}</span>
            <select
              aria-label={t('language')}
              value={preferences.locale}
              onChange={(event) =>
                updatePreferences({
                  ...preferences,
                  locale: event.target.value === 'de' ? 'de' : 'en',
                })
              }
            >
              <option value="en">{t('english')}</option>
              <option value="de">{t('german')}</option>
            </select>
          </label>
          <span className="network-state" role="status" aria-live="polite">
            {isOnline ? t('online') : t('offline')}
          </span>
        </div>
      </header>

      <main id="main-content" className="app-main" role="tabpanel" aria-labelledby={`${activeTab}-tab`}>
        {activeTab === 'flight' ? (
          <Suspense
            fallback={
              <section className="empty-page" role="status">
                {t('loadingFlight')}
              </section>
            }
          >
            <LazyFlightPage
              flight={flight}
              windUnit={preferences.windUnit}
              onlineFlightMapEnabled={onlineFlightMapEnabled}
              onImportStart={() => {
                setOnlineFlightMapEnabled(false)
                setFlight(null)
              }}
              onFlightLoaded={(nextFlight) => {
                setOnlineFlightMapEnabled(false)
                setFlight(nextFlight)
              }}
              onRemoveFlight={() => {
                setOnlineFlightMapEnabled(false)
                setFlight(null)
              }}
              onEnableOnlineMap={() => setOnlineFlightMapEnabled(true)}
            />
          </Suspense>
        ) : (
          <Suspense
            fallback={
              <section className="empty-page" role="status">
                {t('refreshing')}
              </section>
            }
          >
            <LazyWeatherPage
              siteId={activeWeatherSite}
              selectedStationId={activeStationId}
              preferences={preferences}
              onPreferencesChange={updatePreferences}
              onSiteChange={setActiveWeatherSite}
              onStationChange={setActiveStationId}
            />
          </Suspense>
        )}
      </main>

      <nav className="tab-bar" aria-label="Primary" role="tablist">
        <button
          type="button"
          role="tab"
          id="flight-tab"
          aria-controls="main-content"
          aria-selected={activeTab === 'flight'}
          onClick={() => activateTab('flight')}
          onKeyDown={handleTabKeyDown}
        >
          <span aria-hidden="true">↗</span>
          {t('flightTab')}
        </button>
        <button
          type="button"
          role="tab"
          id="weather-tab"
          aria-controls="main-content"
          aria-selected={activeTab === 'weather'}
          onClick={() => activateTab('weather')}
          onKeyDown={handleTabKeyDown}
        >
          <span aria-hidden="true">≋</span>
          {t('weatherTab')}
        </button>
      </nav>
    </div>
  )
}

export function App() {
  const [preferences, setPreferences] = useState(loadPreferences)
  return (
    <I18nProvider locale={preferences.locale}>
      <AppContent preferences={preferences} setPreferences={setPreferences} />
    </I18nProvider>
  )
}
