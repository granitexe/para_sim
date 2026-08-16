import { useEffect, useId, useRef, useState } from 'react'
import { useI18n } from '../i18n/I18nProvider'

export interface MarkerToggleItem {
  id: string
  label: string
}

export interface MarkerToggleGroup {
  id: string
  label: string
  items: MarkerToggleItem[]
}

interface MapOverlayControlsProps {
  markerGroups: MarkerToggleGroup[]
  hiddenMarkerIds: ReadonlySet<string>
  onToggleMarker: (id: string) => void
  arrowsVisible?: boolean
  onToggleArrows?: () => void
}

export function MapOverlayControls({
  markerGroups,
  hiddenMarkerIds,
  onToggleMarker,
  arrowsVisible,
  onToggleArrows,
}: MapOverlayControlsProps) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverId = useId()
  const populatedGroups = markerGroups.filter((group) => group.items.length > 0)

  useEffect(() => {
    if (!open) return
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', closeOnPointerDown)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnPointerDown)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  const closePopover = () => {
    setOpen(false)
    triggerRef.current?.focus()
  }

  return (
    <div ref={rootRef} className="map-overlay-controls">
      <button
        ref={triggerRef}
        type="button"
        className="map-overlay-trigger"
        aria-expanded={open}
        aria-controls={popoverId}
        aria-haspopup="dialog"
        aria-label={t('mapMarkers')}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="map-overlay-trigger-icon" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <span>{t('mapMarkers')}</span>
      </button>
      {open ? (
        <div
          id={popoverId}
          className="map-control-popover"
          role="dialog"
          aria-label={t('mapMarkers')}
        >
          <div className="map-control-heading">
            <strong>{t('mapMarkers')}</strong>
            <button type="button" aria-label={t('collapseDetails')} onClick={closePopover}>
              ×
            </button>
          </div>
          {arrowsVisible !== undefined && onToggleArrows !== undefined ? (
            <label className="map-control-switch">
              <span>{t('windArrows')}</span>
              <span className="map-switch">
                <input
                  type="checkbox"
                  role="switch"
                  aria-label={t('windArrows')}
                  checked={arrowsVisible}
                  onChange={onToggleArrows}
                />
                <span className="map-switch-track" aria-hidden="true" />
              </span>
            </label>
          ) : null}
          {populatedGroups.map((group) => {
            const visibleCount = group.items.filter(
              (item) => !hiddenMarkerIds.has(item.id),
            ).length
            return (
              <details
                key={group.id}
                className="map-control-group"
                data-map-control-group={group.id}
              >
                <summary>
                  <span>{group.label}</span>
                  <small>{visibleCount}/{group.items.length}</small>
                </summary>
                <div className="marker-switch-list">
                  {group.items.map((item) => (
                    <label key={item.id} className="marker-switch-row">
                      <span>{item.label}</span>
                      <span className="map-switch">
                        <input
                          type="checkbox"
                          role="switch"
                          aria-label={item.label}
                          checked={!hiddenMarkerIds.has(item.id)}
                          onChange={() => onToggleMarker(item.id)}
                        />
                        <span className="map-switch-track" aria-hidden="true" />
                      </span>
                    </label>
                  ))}
                </div>
              </details>
            )
          })}
          <p className="muted compact-note map-control-hint">{t('markerLabelHint')}</p>
        </div>
      ) : null}
    </div>
  )
}
