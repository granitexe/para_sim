import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react'
import { messages, type Locale, type MessageKey } from './messages'

interface I18nValue {
  locale: Locale
  t: (key: MessageKey, variables?: Record<string, string | number>) => string
  formatVienna: (timestampMs: number, options?: Intl.DateTimeFormatOptions) => string
  formatUtc: (timestampMs: number, options?: Intl.DateTimeFormatOptions) => string
}

const I18nContext = createContext<I18nValue | null>(null)

function interpolate(template: string, variables?: Record<string, string | number>): string {
  if (variables === undefined) return template
  return template.replace(/\{([A-Za-z0-9_]+)\}/gu, (match, key: string) =>
    Object.hasOwn(variables, key) ? String(variables[key]) : match,
  )
}

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const value = useMemo<I18nValue>(() => {
    const languageTag = locale === 'de' ? 'de-AT' : 'en-GB'
    return {
      locale,
      t: (key, variables) => interpolate(messages[locale][key], variables),
      formatVienna: (timestampMs, options) =>
        new Intl.DateTimeFormat(languageTag, {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: 'Europe/Vienna',
          ...options,
        }).format(timestampMs),
      formatUtc: (timestampMs, options) =>
        new Intl.DateTimeFormat(languageTag, {
          dateStyle: 'medium',
          timeStyle: 'medium',
          timeZone: 'UTC',
          ...options,
        }).format(timestampMs),
    }
  }, [locale])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext)
  if (value === null) throw new Error('useI18n must be used inside I18nProvider')
  return value
}
