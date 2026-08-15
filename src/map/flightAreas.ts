import {
  Cartesian2,
  Cartesian3,
  Color,
  DistanceDisplayCondition,
  HeightReference,
  HorizontalOrigin,
  PolygonHierarchy,
  VerticalOrigin,
  type Viewer,
} from 'cesium'
import { flightAreas, siteRestrictions, type SiteId } from '../domain/sites'
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

export function addFlightAreaEntities(viewer: Viewer, locale: Locale, siteId?: SiteId): void {
  for (const area of flightAreas) {
    if (siteId !== undefined && area.siteId !== siteId) continue
    const color = area.kind === 'takeoff' ? Color.fromCssColorString('#FFB454') : Color.fromCssColorString('#4DD0A8')
    if (area.outline.length >= 3) {
      viewer.entities.add({
        name: area.name[locale],
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
    }
    viewer.entities.add({
      name: area.name[locale],
      position: Cartesian3.fromDegrees(area.longitude, area.latitude),
      billboard: {
        image: area.kind === 'takeoff' ? takeoffImage : landingImage,
        width: 34,
        height: 34,
        heightReference: HeightReference.CLAMP_TO_GROUND,
        verticalOrigin: VerticalOrigin.CENTER,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: area.name[locale],
        font: '700 13px system-ui',
        fillColor: Color.WHITE,
        showBackground: true,
        backgroundColor: Color.fromCssColorString('#0B1117').withAlpha(0.86),
        pixelOffset: new Cartesian2(0, -24),
        horizontalOrigin: HorizontalOrigin.CENTER,
        verticalOrigin: VerticalOrigin.BOTTOM,
        distanceDisplayCondition: new DistanceDisplayCondition(0, 18_000),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    })
  }

  for (const restriction of siteRestrictions) {
    if (siteId !== undefined && restriction.siteId !== siteId) continue
    viewer.entities.add({
      name: restriction.name[locale],
      position: Cartesian3.fromDegrees(restriction.longitude, restriction.latitude),
      billboard: {
        image: restrictionImage,
        width: 36,
        height: 36,
        heightReference: HeightReference.CLAMP_TO_GROUND,
        verticalOrigin: VerticalOrigin.CENTER,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: restriction.name[locale],
        font: '700 13px system-ui',
        fillColor: Color.WHITE,
        showBackground: true,
        backgroundColor: Color.fromCssColorString('#5E1F24').withAlpha(0.9),
        pixelOffset: new Cartesian2(0, -25),
        horizontalOrigin: HorizontalOrigin.CENTER,
        verticalOrigin: VerticalOrigin.BOTTOM,
        distanceDisplayCondition: new DistanceDisplayCondition(0, 18_000),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    })
  }
}
