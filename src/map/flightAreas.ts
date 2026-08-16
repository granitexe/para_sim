import {
  Cartesian2,
  Cartesian3,
  Color,
  DistanceDisplayCondition,
  HeightReference,
  HorizontalOrigin,
  PolygonHierarchy,
  VerticalOrigin,
  type Entity,
  type Viewer,
} from 'cesium'
import {
  flightAreas,
  siteRestrictions,
  type FlightAreaKind,
  type SiteId,
} from '../domain/sites'
import type { Locale } from '../i18n/messages'

function svgImage(markup: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`
}

const takeoffImage = svgImage(
  '<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36"><path d="M18 3 33 31H3Z" fill="#ffb454" stroke="#0b1117" stroke-width="3"/><path d="M18 10v13m0 0-5-5m5 5 5-5" fill="none" stroke="#0b1117" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
)
const landingImage = svgImage(
  '<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36"><circle cx="18" cy="18" r="15" fill="#4dd0a8" stroke="#0b1117" stroke-width="3"/><path d="M18 8v14m0 0-6-6m6 6 6-6M10 28h16" fill="none" stroke="#0b1117" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
)
const restrictionImage = svgImage(
  '<svg xmlns="http://www.w3.org/2000/svg" width="38" height="38" viewBox="0 0 38 38"><path d="M19 2 37 35H1Z" fill="#d94c4c" stroke="#fff" stroke-width="2"/><path d="M19 12v11m0 6v-2" stroke="#fff" stroke-width="4" stroke-linecap="round"/></svg>',
)

export type FlightAreaMarkerKind = FlightAreaKind | 'restriction'

export interface FlightAreaEntityGroup {
  id: string
  kind: FlightAreaMarkerKind
  marker: Entity
  label: Entity
  shape?: Entity
}

const noHiddenMarkerIds: ReadonlySet<string> = new Set()

export function setFlightAreaMarkerVisibility(
  groups: FlightAreaEntityGroup[],
  hiddenMarkerIds: ReadonlySet<string>,
): void {
  for (const group of groups) {
    const visible = !hiddenMarkerIds.has(group.id)
    group.marker.show = visible
    if (group.shape !== undefined) group.shape.show = visible
    if (!visible) group.label.show = false
  }
}

export function selectFlightAreaMarker(
  groups: FlightAreaEntityGroup[],
  selectedMarker: Entity | undefined,
): boolean {
  const selectedGroup = groups.find((group) => group.marker === selectedMarker)
  const showSelected =
    selectedGroup !== undefined && selectedGroup.marker.show && !selectedGroup.label.show
  for (const group of groups) group.label.show = false
  if (showSelected) selectedGroup.label.show = true
  return selectedGroup !== undefined
}

export function addFlightAreaEntities(
  viewer: Viewer,
  locale: Locale,
  siteId?: SiteId,
  hiddenMarkerIds: ReadonlySet<string> = noHiddenMarkerIds,
): FlightAreaEntityGroup[] {
  const groups: FlightAreaEntityGroup[] = []
  for (const area of flightAreas) {
    if (siteId !== undefined && area.siteId !== siteId) continue
    const color =
      area.kind === 'takeoff'
        ? Color.fromCssColorString('#FFB454')
        : Color.fromCssColorString('#4DD0A8')
    const shape =
      area.outline.length >= 3
        ? viewer.entities.add({
            name: area.name[locale],
            show: !hiddenMarkerIds.has(area.id),
            polygon: {
              hierarchy: new PolygonHierarchy(
                area.outline.map((coordinate) =>
                  Cartesian3.fromDegrees(coordinate.longitude, coordinate.latitude),
                ),
              ),
              material: color.withAlpha(0.2),
              outline: true,
              outlineColor: color.withAlpha(0.95),
              heightReference: HeightReference.CLAMP_TO_GROUND,
            },
          })
        : undefined
    const position = Cartesian3.fromDegrees(area.longitude, area.latitude)
    const marker = viewer.entities.add({
      name: area.name[locale],
      show: !hiddenMarkerIds.has(area.id),
      position,
      billboard: {
        image: area.kind === 'takeoff' ? takeoffImage : landingImage,
        width: 34,
        height: 34,
        heightReference: HeightReference.CLAMP_TO_GROUND,
        verticalOrigin: VerticalOrigin.CENTER,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    })
    const label = viewer.entities.add({
      name: area.name[locale],
      show: false,
      position,
      label: {
        text: area.name[locale],
        font: '700 13px system-ui',
        fillColor: Color.WHITE,
        showBackground: true,
        backgroundColor: Color.fromCssColorString('#0B1117').withAlpha(0.9),
        pixelOffset: new Cartesian2(0, -24),
        horizontalOrigin: HorizontalOrigin.CENTER,
        verticalOrigin: VerticalOrigin.BOTTOM,
        distanceDisplayCondition: new DistanceDisplayCondition(0, 80_000),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    })
    groups.push({ id: area.id, kind: area.kind, marker, label, shape })
  }

  for (const restriction of siteRestrictions) {
    if (siteId !== undefined && restriction.siteId !== siteId) continue
    const position = Cartesian3.fromDegrees(restriction.longitude, restriction.latitude)
    const marker = viewer.entities.add({
      name: restriction.name[locale],
      show: !hiddenMarkerIds.has(restriction.id),
      position,
      billboard: {
        image: restrictionImage,
        width: 36,
        height: 36,
        heightReference: HeightReference.CLAMP_TO_GROUND,
        verticalOrigin: VerticalOrigin.CENTER,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    })
    const label = viewer.entities.add({
      name: restriction.name[locale],
      show: false,
      position,
      label: {
        text: restriction.name[locale],
        font: '700 13px system-ui',
        fillColor: Color.WHITE,
        showBackground: true,
        backgroundColor: Color.fromCssColorString('#5E1F24').withAlpha(0.92),
        pixelOffset: new Cartesian2(0, -25),
        horizontalOrigin: HorizontalOrigin.CENTER,
        verticalOrigin: VerticalOrigin.BOTTOM,
        distanceDisplayCondition: new DistanceDisplayCondition(0, 80_000),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    })
    groups.push({ id: restriction.id, kind: 'restriction', marker, label })
  }
  return groups
}
