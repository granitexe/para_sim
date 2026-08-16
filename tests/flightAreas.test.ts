import { Entity } from 'cesium'
import { describe, expect, it } from 'vitest'
import {
  selectFlightAreaMarker,
  setFlightAreaMarkerVisibility,
  type FlightAreaEntityGroup,
} from '../src/map/flightAreas'

function group(
  kind: FlightAreaEntityGroup['kind'],
  id = `${kind}-marker`,
): FlightAreaEntityGroup {
  return {
    id,
    kind,
    marker: new Entity({ show: true }),
    label: new Entity({ show: false }),
    shape: new Entity({ show: true }),
  }
}

describe('flight-area marker presentation', () => {
  it('shows at most one selected marker label and toggles it closed', () => {
    const takeoff = group('takeoff')
    const landing = group('landing')
    const groups = [takeoff, landing]

    expect(selectFlightAreaMarker(groups, takeoff.marker)).toBe(true)
    expect(takeoff.label.show).toBe(true)
    expect(landing.label.show).toBe(false)

    expect(selectFlightAreaMarker(groups, landing.marker)).toBe(true)
    expect(takeoff.label.show).toBe(false)
    expect(landing.label.show).toBe(true)

    expect(selectFlightAreaMarker(groups, landing.marker)).toBe(true)
    expect(takeoff.label.show).toBe(false)
    expect(landing.label.show).toBe(false)
  })

  it('hides only the selected marker, its shape, and any open label', () => {
    const takeoff = group('takeoff', 'takeoff-a')
    const otherTakeoff = group('takeoff', 'takeoff-b')
    const restriction = group('restriction', 'restriction-a')
    takeoff.label.show = true

    setFlightAreaMarkerVisibility(
      [takeoff, otherTakeoff, restriction],
      new Set(['takeoff-a']),
    )

    expect(takeoff.marker.show).toBe(false)
    expect(takeoff.shape?.show).toBe(false)
    expect(takeoff.label.show).toBe(false)
    expect(otherTakeoff.marker.show).toBe(true)
    expect(otherTakeoff.shape?.show).toBe(true)
    expect(restriction.marker.show).toBe(true)
    expect(restriction.shape?.show).toBe(true)
  })
})
