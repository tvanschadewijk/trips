'use client';

import { importLibrary, setOptions } from '@googlemaps/js-api-loader';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { TripRouteAtlas, TripRouteAtlasPoint } from '@/lib/trip-route';
import type { ItineraryMapPoiSearchTarget, ItineraryMapPointDetail } from '@/lib/day-map';
import '@/styles/itinerary-map.css';

type MapVariant = 'overview-card' | 'day';

interface ItineraryMapProps {
  atlas: TripRouteAtlas;
  title: string;
  variant?: MapVariant;
  interactive?: boolean;
  fallback?: ReactNode;
  className?: string;
  pointDetails?: Record<string, ItineraryMapPointDetail>;
  showLines?: boolean;
  enabled?: boolean;
  loadingLabel?: string;
  loadingHint?: string;
  searchTargets?: ItineraryMapPoiSearchTarget[];
  focusRequest?: ItineraryMapFocusRequest;
  viewAllRequest?: ItineraryMapViewAllRequest;
}

interface RouteSegment {
  mode: string;
  path: google.maps.LatLngLiteral[];
}

interface PointDisplay {
  id: string;
  label: string;
  marker: string;
  role: string;
  position: google.maps.LatLngLiteral;
  detail: ItineraryMapPointDetail;
}

interface PopupOptions {
  includeMapActions?: boolean;
}

export interface ItineraryMapFocusRequest {
  id?: string;
  label?: string;
  nonce: number;
}

export interface ItineraryMapViewAllRequest {
  nonce: number;
}

interface MarkerController {
  markers: google.maps.marker.AdvancedMarkerElement[];
  cleanupHandlers: (() => void)[];
  focusPoint: (request: ItineraryMapFocusRequest) => boolean;
  clearSelection: () => void;
}

type ResolvedSearchTarget = {
  point: TripRouteAtlasPoint;
  detail: ItineraryMapPointDetail;
};

const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
const GOOGLE_MAPS_MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID;
const MAP_POPOVER_Z_INDEX = 1_000_000;
const HOVER_POPUP_CLOSE_DELAY_MS = 160;
const POINT_FOCUS_ZOOM = 17;
const MIN_MAP_ZOOM = 1;
const MAX_MAP_ZOOM = 21;
const OVERVIEW_MAP_FIT_PADDING = { top: 28, right: 24, bottom: 28, left: 24 } satisfies google.maps.Padding;
const DAY_MAP_FIT_PADDING = { top: 24, right: 24, bottom: 24, left: 24 } satisfies google.maps.Padding;
const DAY_MAP_REFIT_PADDING = { top: 40, right: 40, bottom: 40, left: 40 } satisfies google.maps.Padding;
const PLACE_FALLBACK_MAX_DISTANCE_KM = 120;
const POI_RESULT_BOUNDS_PAD_DEGREES = 0.04;
const SEARCH_CACHE = new Map<string, ResolvedSearchTarget | null>();
const PLACE_AREA_TYPES = new Set([
  'administrative_area_level_1',
  'administrative_area_level_2',
  'administrative_area_level_3',
  'country',
  'locality',
  'neighborhood',
  'political',
  'postal_code',
  'route',
]);

let googleMapsConfigured = false;

function configureGoogleMaps(apiKey: string) {
  if (googleMapsConfigured) return;

  const options: Parameters<typeof setOptions>[0] = {
    key: apiKey,
    v: 'weekly',
    language: 'en',
    authReferrerPolicy: 'origin',
  };

  if (GOOGLE_MAPS_MAP_ID) options.mapIds = [GOOGLE_MAPS_MAP_ID];
  setOptions(options);
  googleMapsConfigured = true;
}

function toLatLng(point: Pick<TripRouteAtlasPoint, 'lat' | 'lng'>): google.maps.LatLngLiteral {
  return { lat: point.lat, lng: point.lng };
}

function routeSegmentsFor(atlas: TripRouteAtlas): RouteSegment[] {
  const segments = atlas.legs
    .map((leg) => {
      const from = atlas.points[leg.from];
      const to = atlas.points[leg.to];
      if (!from || !to) return undefined;
      return {
        mode: leg.mode || 'route',
        path: [toLatLng(from), toLatLng(to)],
      };
    })
    .filter((segment): segment is RouteSegment => Boolean(segment));

  if (!segments.length && atlas.points.length > 1) {
    segments.push({
      mode: 'route',
      path: atlas.points.map(toLatLng),
    });
  }

  return segments;
}

function boundsFor(points: TripRouteAtlasPoint[]): TripRouteAtlas['bounds'] {
  return {
    minLat: Math.min(...points.map((point) => point.lat)),
    maxLat: Math.max(...points.map((point) => point.lat)),
    minLng: Math.min(...points.map((point) => point.lng)),
    maxLng: Math.max(...points.map((point) => point.lng)),
  };
}

function atlasFromResolvedTargets(resolved: ResolvedSearchTarget[]): TripRouteAtlas {
  const points = resolved.map(({ point }, index) => ({
    ...point,
    index,
  }));

  return {
    points,
    legs: [],
    modes: [],
    bounds: boundsFor(points),
  };
}

function pointDataFor(atlas: TripRouteAtlas, variant: MapVariant, pointDetails?: Record<string, ItineraryMapPointDetail>): PointDisplay[] {
  const hasHomeStart = atlas.points[0]?.role === 'home';
  return atlas.points.map((point) => {
    const detail = pointDetails?.[point.id] ?? {};
    return {
      id: point.id,
      label: point.label,
      marker: variant === 'day'
        ? String(point.index + 1)
        : point.role === 'home'
          ? ''
          : String(hasHomeStart ? point.index : point.index + 1),
      role: point.role ?? 'stop',
      position: toLatLng(point),
      detail: {
        title: detail.title ?? point.label,
        kicker: detail.kicker,
        body: detail.body,
      },
    };
  });
}

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function searchQueriesFor(target: ItineraryMapPoiSearchTarget): string[] {
  const base = target.query || target.label;
  const withoutApostrophes = base.replace(/[’']/g, ' ');
  return [...new Set([base, withoutApostrophes, target.label, target.label.replace(/[’']/g, ' ')])]
    .map((query) => query.trim())
    .filter((query) => query.length >= 3);
}

function boundsLiteralFor(bbox: [number, number, number, number]): google.maps.LatLngBoundsLiteral {
  return {
    west: bbox[0],
    south: bbox[1],
    east: bbox[2],
    north: bbox[3],
  };
}

function pointInsideBbox(
  position: google.maps.LatLngLiteral,
  bbox: [number, number, number, number],
  padDegrees = 0
): boolean {
  return (
    position.lng >= bbox[0] - padDegrees &&
    position.lng <= bbox[2] + padDegrees &&
    position.lat >= bbox[1] - padDegrees &&
    position.lat <= bbox[3] + padDegrees
  );
}

function distanceKm(
  left: google.maps.LatLngLiteral,
  right: google.maps.LatLngLiteral
): number {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const latDelta = toRadians(right.lat - left.lat);
  const lngDelta = toRadians(right.lng - left.lng);
  const leftLat = toRadians(left.lat);
  const rightLat = toRadians(right.lat);
  const a =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(leftLat) * Math.cos(rightLat) * Math.sin(lngDelta / 2) ** 2;
  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function searchResultFitsTarget(
  target: ItineraryMapPoiSearchTarget,
  position: google.maps.LatLngLiteral
): boolean {
  if (target.kind === 'poi' && target.bbox && !pointInsideBbox(position, target.bbox, POI_RESULT_BOUNDS_PAD_DEGREES)) {
    return false;
  }

  if (target.kind === 'place' && target.fallbackPoint) {
    return distanceKm(position, {
      lat: target.fallbackPoint.lat,
      lng: target.fallbackPoint.lng,
    }) <= PLACE_FALLBACK_MAX_DISTANCE_KM;
  }

  return true;
}

function locationBiasFor(target: ItineraryMapPoiSearchTarget): google.maps.places.SearchByTextRequest['locationBias'] | undefined {
  if (target.kind === 'poi' && target.bbox) return undefined;
  if (target.bbox) return boundsLiteralFor(target.bbox);
  if (!target.proximity) return undefined;

  return {
    center: { lat: target.proximity[1], lng: target.proximity[0] },
    radius: target.kind === 'place' ? 90000 : 35000,
  };
}

function locationRestrictionFor(target: ItineraryMapPoiSearchTarget): google.maps.places.SearchByTextRequest['locationRestriction'] | undefined {
  if (target.kind !== 'poi' || !target.bbox) return undefined;
  return boundsLiteralFor(target.bbox);
}

function placeCoordinates(place: google.maps.places.Place): google.maps.LatLngLiteral | undefined {
  const location = place.location;
  if (!location) return undefined;

  const lat = location.lat();
  const lng = location.lng();
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  return { lat, lng };
}

function isAreaResult(place: google.maps.places.Place): boolean {
  const types = [place.primaryType, ...(place.types ?? [])].filter((type): type is string => Boolean(type));
  return types.some((type) => PLACE_AREA_TYPES.has(type));
}

function pickSearchPlace(places: google.maps.places.Place[] | undefined, target: ItineraryMapPoiSearchTarget): google.maps.places.Place | undefined {
  const candidates = (places ?? []).filter((place) => placeCoordinates(place));
  if (!candidates.length) return undefined;
  if (target.kind === 'place') return candidates[0];
  if (target.placeType) return candidates.find((place) => !isAreaResult(place)) ?? candidates[0];

  const targetText = normalizeSearchText(target.label);
  return candidates.find((place) => {
    if (isAreaResult(place)) return false;
    const name = normalizeSearchText(place.displayName ?? '');
    return !name || targetText.includes(name) || name.includes(targetText.split(' ')[0] ?? targetText);
  }) ?? candidates.find((place) => !isAreaResult(place));
}

function resolvedTargetFromFallback(target: ItineraryMapPoiSearchTarget, index: number): ResolvedSearchTarget | null {
  if (!target.fallbackPoint) return null;

  return {
    point: {
      id: target.id,
      index,
      label: target.label,
      lat: target.fallbackPoint.lat,
      lng: target.fallbackPoint.lng,
      role: target.role ?? 'stop',
      source: target.fallbackPoint.source ?? 'derived',
    },
    detail: {
      title: target.detail?.title ?? target.label,
      kicker: target.detail?.kicker,
      body: target.detail?.body,
    },
  };
}

async function resolveSearchTarget(target: ItineraryMapPoiSearchTarget, apiKey: string): Promise<ResolvedSearchTarget | null> {
  const cacheKey = JSON.stringify({
    label: target.label,
    query: target.query,
    proximity: target.proximity,
    bbox: target.bbox,
    kind: target.kind,
    placeType: target.placeType,
    fallbackPoint: target.fallbackPoint
      ? [target.fallbackPoint.lat, target.fallbackPoint.lng]
      : undefined,
  });
  if (SEARCH_CACHE.has(cacheKey)) return SEARCH_CACHE.get(cacheKey) ?? null;

  // Route stops are already grounded by the trip atlas. Prefer that coordinate
  // over global text search so ambiguous cities do not jump continents.
  if (target.kind === 'place' && target.fallbackPoint) {
    const resolved = resolvedTargetFromFallback(target, 0);
    SEARCH_CACHE.set(cacheKey, resolved);
    return resolved;
  }

  let Place: typeof google.maps.places.Place;
  try {
    configureGoogleMaps(apiKey);
    ({ Place } = await importLibrary('places'));
  } catch {
    SEARCH_CACHE.set(cacheKey, null);
    return null;
  }

  for (const query of searchQueriesFor(target)) {
    try {
      const locationRestriction = locationRestrictionFor(target);
      const request: google.maps.places.SearchByTextRequest = {
        textQuery: query,
        fields: ['displayName', 'formattedAddress', 'location', 'primaryType', 'types'],
        language: 'en',
        maxResultCount: 5,
      };
      if (locationRestriction) {
        request.locationRestriction = locationRestriction;
      } else {
        request.locationBias = locationBiasFor(target);
      }
      if (target.placeType) {
        request.includedType = target.placeType;
        request.useStrictTypeFiltering = target.placeType === 'lodging' || target.placeType === 'restaurant';
      }

      const result = await Place.searchByText({
        ...request,
      });
      const place = pickSearchPlace(result.places, target);
      const position = place ? placeCoordinates(place) : undefined;
      if (!place || !position) continue;
      if (!searchResultFitsTarget(target, position)) continue;

      const resolved: ResolvedSearchTarget = {
        point: {
          id: target.id,
          index: 0,
          label: target.label,
          lat: position.lat,
          lng: position.lng,
          role: target.role ?? 'stop',
          source: 'derived',
        },
        detail: {
          title: target.detail?.title ?? target.label,
          kicker: target.detail?.kicker,
          body: target.detail?.body || place.formattedAddress || '',
        },
      };
      SEARCH_CACHE.set(cacheKey, resolved);
      return resolved;
    } catch {
      continue;
    }
  }

  SEARCH_CACHE.set(cacheKey, null);
  return null;
}

function centerFor(atlas: TripRouteAtlas): google.maps.LatLngLiteral {
  return {
    lat: (atlas.bounds.minLat + atlas.bounds.maxLat) / 2,
    lng: (atlas.bounds.minLng + atlas.bounds.maxLng) / 2,
  };
}

function routeColorFor(mode: string): string {
  switch (mode) {
    case 'walk':
      return '#9B4F2E';
    case 'train':
      return '#1A1410';
    case 'ferry':
      return '#2F6B4A';
    case 'flight':
      return '#6B6157';
    default:
      return '#C14F2A';
  }
}

function mapContainsAllPoints(map: google.maps.Map, atlas: TripRouteAtlas): boolean {
  const visibleBounds = map.getBounds();
  return Boolean(visibleBounds && atlas.points.every((point) => visibleBounds.contains(toLatLng(point))));
}

function fitMap(map: google.maps.Map, atlas: TripRouteAtlas, variant: MapVariant): google.maps.MapsEventListener | undefined {
  if (atlas.points.length === 1) {
    map.setCenter(toLatLng(atlas.points[0]));
    map.setZoom(variant === 'overview-card' ? 9 : POINT_FOCUS_ZOOM);
    return undefined;
  }

  const bounds = new google.maps.LatLngBounds(
    { lat: atlas.bounds.minLat, lng: atlas.bounds.minLng },
    { lat: atlas.bounds.maxLat, lng: atlas.bounds.maxLng }
  );

  map.fitBounds(bounds, variant === 'overview-card' ? OVERVIEW_MAP_FIT_PADDING : DAY_MAP_FIT_PADDING);

  if (variant !== 'overview-card') {
    return google.maps.event.addListenerOnce(map, 'idle', () => {
      if (!mapContainsAllPoints(map, atlas)) map.fitBounds(bounds, DAY_MAP_REFIT_PADDING);
    });
  }

  const maxZoom = 8.4;
  return google.maps.event.addListenerOnce(map, 'idle', () => {
    const zoom = map.getZoom();
    if (zoom && zoom > maxZoom) map.setZoom(maxZoom);
  });
}

function googleMapsLinkFor(point: PointDisplay): string {
  const lat = point.position.lat.toFixed(6);
  const lng = point.position.lng.toFixed(6);
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

function popupContentFor(point: PointDisplay, options: PopupOptions = {}): HTMLElement {
  const popup = document.createElement('div');
  popup.className = 'itinerary-map-stop-popup';

  const title = document.createElement('div');
  title.className = 'itinerary-map-stop-popup-title';
  title.textContent = point.detail.title || point.label || 'Stop';
  popup.append(title);

  if (point.detail.body) {
    const body = document.createElement('div');
    body.className = 'itinerary-map-stop-popup-body';
    body.textContent = point.detail.body;
    popup.append(body);
  }

  if (options.includeMapActions) {
    const actions = document.createElement('div');
    actions.className = 'itinerary-map-stop-popup-actions';

    const link = document.createElement('a');
    link.className = 'itinerary-map-stop-popup-link';
    link.href = googleMapsLinkFor(point);
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.setAttribute('aria-label', `Open ${point.detail.title || point.label || 'this location'} in Google Maps`);
    link.textContent = 'Maps';
    actions.append(link);

    popup.append(actions);
  }

  return popup;
}

function safeRoleClass(role: string): string {
  return role.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
}

function markerElementFor(point: PointDisplay, variant: MapVariant): HTMLButtonElement {
  const marker = document.createElement('button');
  marker.type = 'button';
  marker.className = [
    'itinerary-map-marker',
    `itinerary-map-marker-${variant}`,
    `itinerary-map-marker-${safeRoleClass(point.role)}`,
  ].join(' ');
  marker.setAttribute('aria-label', point.detail.title || point.label);

  const halo = document.createElement('span');
  halo.className = 'itinerary-map-marker-halo';
  halo.setAttribute('aria-hidden', 'true');

  const dot = document.createElement('span');
  dot.className = 'itinerary-map-marker-dot';
  dot.setAttribute('aria-hidden', 'true');
  halo.append(dot);

  if (point.marker) {
    const label = document.createElement('span');
    label.className = 'itinerary-map-marker-label';
    label.textContent = point.marker;
    label.setAttribute('aria-hidden', 'true');
    halo.append(label);
  }

  marker.append(halo);
  return marker;
}

function addRouteLines(map: google.maps.Map, routeSegments: RouteSegment[], variant: MapVariant): google.maps.Polyline[] {
  return routeSegments.flatMap((segment) => {
    const isOverview = variant === 'overview-card';
    const routeColor = isOverview ? '#C14F2A' : routeColorFor(segment.mode);
    const baseOptions: google.maps.PolylineOptions = {
      clickable: false,
      geodesic: true,
      map,
      path: segment.path,
    };
    const casing = new google.maps.Polyline({
      ...baseOptions,
      strokeColor: '#FBF7F1',
      strokeOpacity: isOverview ? 0.96 : 0.92,
      strokeWeight: isOverview ? 8 : 10,
      zIndex: 1,
    });
    const line = new google.maps.Polyline({
      ...baseOptions,
      icons: isOverview
        ? [{
            icon: {
              path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
              fillColor: routeColor,
              fillOpacity: 1,
              scale: 2.4,
              strokeColor: '#FBF7F1',
              strokeOpacity: 0.95,
              strokeWeight: 1.4,
            },
            offset: '100%',
            repeat: '140px',
          }]
        : undefined,
      strokeColor: routeColor,
      strokeOpacity: isOverview ? 0.88 : 0.96,
      strokeWeight: isOverview ? 4 : 6,
      zIndex: 2,
    });

    return [casing, line];
  });
}

function addPointMarkers(
  map: google.maps.Map,
  AdvancedMarkerElement: typeof google.maps.marker.AdvancedMarkerElement,
  points: PointDisplay[],
  variant: MapVariant
): MarkerController {
  const infoWindow = new google.maps.InfoWindow({
    disableAutoPan: variant === 'overview-card',
    headerDisabled: true,
    maxWidth: variant === 'overview-card' ? 420 : 360,
    pixelOffset: new google.maps.Size(0, variant === 'overview-card' ? -26 : -34),
    zIndex: MAP_POPOVER_Z_INDEX,
  });
  const cleanupHandlers: (() => void)[] = [];
  let hoverCloseTimer: number | undefined;
  let pinnedPointId: string | null = null;
  let activePopupKey: string | null = null;
  let popupCleanup: (() => void) | undefined;
  const clearHoverCloseTimer = () => {
    if (!hoverCloseTimer) return;
    window.clearTimeout(hoverCloseTimer);
    hoverCloseTimer = undefined;
  };
  const closePopup = () => {
    clearHoverCloseTimer();
    popupCleanup?.();
    popupCleanup = undefined;
    activePopupKey = null;
    infoWindow.close();
  };
  const scheduleHoverPopupClose = () => {
    if (pinnedPointId) return;
    clearHoverCloseTimer();
    hoverCloseTimer = window.setTimeout(() => {
      closePopup();
    }, HOVER_POPUP_CLOSE_DELAY_MS);
  };
  const mapClickListener = map.addListener('click', () => {
    pinnedPointId = null;
    closePopup();
  });
  const clearSelection = () => {
    pinnedPointId = null;
    closePopup();
  };
  const controllers: {
    point: PointDisplay;
    marker: google.maps.marker.AdvancedMarkerElement;
    showPinnedPopup: () => void;
  }[] = [];
  const markers = points.map((point, index) => {
    const content = markerElementFor(point, variant);
    const marker = new AdvancedMarkerElement({
      anchorLeft: '-50%',
      anchorTop: '-50%',
      content,
      gmpClickable: true,
      map,
      position: point.position,
      title: point.detail.title || point.label,
      zIndex: point.role === 'home' ? 20 : 30 + index,
    });

    const showPopup = (includeMapActions = false, pinned = false) => {
      if (!pinned && pinnedPointId) return;
      clearHoverCloseTimer();
      if (pinned) pinnedPointId = point.id;
      const popupKey = `${point.id}:${includeMapActions ? 'actions' : 'title'}`;
      if (activePopupKey === popupKey) {
        infoWindow.setZIndex(MAP_POPOVER_Z_INDEX);
        infoWindow.open({ anchor: marker, map, shouldFocus: false });
        return;
      }
      popupCleanup?.();
      const popup = popupContentFor(point, { includeMapActions });
      const stopPopupClick = (event: Event) => event.stopPropagation();
      popup.addEventListener('mouseenter', clearHoverCloseTimer);
      popup.addEventListener('mouseleave', scheduleHoverPopupClose);
      popup.addEventListener('click', stopPopupClick);
      popupCleanup = () => {
        popup.removeEventListener('mouseenter', clearHoverCloseTimer);
        popup.removeEventListener('mouseleave', scheduleHoverPopupClose);
        popup.removeEventListener('click', stopPopupClick);
      };
      activePopupKey = popupKey;
      infoWindow.setContent(popup);
      infoWindow.setZIndex(MAP_POPOVER_Z_INDEX);
      infoWindow.open({ anchor: marker, map, shouldFocus: false });
    };
    const showHoverPopup = () => showPopup(variant === 'day', false);
    const stopAndShowPopup = (event: Event) => {
      event.stopPropagation();
      showPopup(true, true);
    };
    const showPinnedPopup = () => showPopup(true, true);

    content.addEventListener('mouseenter', showHoverPopup);
    content.addEventListener('mousemove', showHoverPopup);
    content.addEventListener('mouseleave', scheduleHoverPopupClose);
    content.addEventListener('click', stopAndShowPopup);
    marker.addEventListener('gmp-click', showPinnedPopup);
    cleanupHandlers.push(() => {
      content.removeEventListener('mouseenter', showHoverPopup);
      content.removeEventListener('mousemove', showHoverPopup);
      content.removeEventListener('mouseleave', scheduleHoverPopupClose);
      content.removeEventListener('click', stopAndShowPopup);
      marker.removeEventListener('gmp-click', showPinnedPopup);
    });
    controllers.push({ point, marker, showPinnedPopup });

    return marker;
  });

  cleanupHandlers.push(() => {
    mapClickListener.remove();
    closePopup();
  });

  const focusPoint = (request: ItineraryMapFocusRequest) => {
    const normalizedLabel = request.label ? normalizeSearchText(request.label) : '';
    const controller = controllers.find(({ point }) => {
      if (request.id && point.id === request.id) return true;
      if (!normalizedLabel) return false;
      return normalizeSearchText(point.label) === normalizedLabel
        || normalizeSearchText(point.detail.title ?? '') === normalizedLabel;
    });
    if (!controller) return false;

    pinnedPointId = controller.point.id;
    map.panTo(controller.point.position);
    const currentZoom = map.getZoom();
    if (!currentZoom || currentZoom < POINT_FOCUS_ZOOM) map.setZoom(POINT_FOCUS_ZOOM);
    controller.showPinnedPopup();
    return true;
  };

  return { markers, cleanupHandlers, focusPoint, clearSelection };
}

export default function ItineraryMap({
  atlas,
  title,
  variant = 'day',
  interactive = false,
  fallback,
  className,
  pointDetails,
  showLines = variant !== 'day',
  enabled = true,
  loadingLabel = 'Loading map',
  loadingHint,
  searchTargets = [],
  focusRequest,
  viewAllRequest,
}: ItineraryMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerControllerRef = useRef<MarkerController | null>(null);
  const handledFocusNonceRef = useRef<number | null>(null);
  const handledViewAllNonceRef = useRef<number | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [currentZoom, setCurrentZoom] = useState<number | null>(null);
  const [searchComplete, setSearchComplete] = useState(searchTargets.length === 0);
  const [resolvedSearchTargets, setResolvedSearchTargets] = useState<ResolvedSearchTarget[]>([]);
  const searchTargetSignature = useMemo(() => JSON.stringify(searchTargets), [searchTargets]);
  const resolvedSearchDetails = useMemo<Record<string, ItineraryMapPointDetail>>(
    () => Object.fromEntries(resolvedSearchTargets.map((target) => [target.point.id, target.detail])),
    [resolvedSearchTargets]
  );
  const displayAtlas = useMemo(
    () => searchComplete && resolvedSearchTargets.length ? atlasFromResolvedTargets(resolvedSearchTargets) : atlas,
    [atlas, resolvedSearchTargets, searchComplete]
  );
  const displayPointDetails = resolvedSearchTargets.length && searchComplete ? resolvedSearchDetails : pointDetails;
  const routeSegments = useMemo(() => routeSegmentsFor(displayAtlas), [displayAtlas]);
  const points = useMemo(() => pointDataFor(displayAtlas, variant, displayPointDetails), [displayAtlas, displayPointDetails, variant]);
  const waitingForSearch = enabled && Boolean(GOOGLE_MAPS_API_KEY) && searchTargets.length > 0 && !searchComplete;
  const showFallback = !GOOGLE_MAPS_API_KEY || (!waitingForSearch && displayAtlas.points.length === 0);
  const showDeferred = !enabled && !showFallback;
  const fallbackNode = fallback ? <div className="itinerary-map-fallback">{fallback}</div> : null;
  const errorNode = (
    <div className="itinerary-map-error">
      <span>Map could not load</span>
    </div>
  );
  const effectiveLoadingLabel = waitingForSearch ? 'Finding day places' : loadingLabel;
  const effectiveLoadingHint = waitingForSearch ? 'Looking up hotels, restaurants and sights for this day.' : loadingHint;
  const useCustomZoomControls = interactive && variant === 'day';
  const showCustomZoomControls = useCustomZoomControls && ready && !showFallback && !showDeferred && !failed;

  const zoomMap = (direction: 1 | -1) => {
    const map = mapRef.current;
    if (!map) return;
    const fallbackZoom = displayAtlas.points.length === 1 ? 11 : 6;
    const baseZoom = map.getZoom() ?? currentZoom ?? fallbackZoom;
    const nextZoom = Math.max(MIN_MAP_ZOOM, Math.min(MAX_MAP_ZOOM, baseZoom + direction));
    map.setZoom(nextZoom);
    setCurrentZoom(nextZoom);
  };

  useEffect(() => {
    const apiKey = GOOGLE_MAPS_API_KEY;
    if (!enabled || !apiKey || !searchTargets.length) {
      setResolvedSearchTargets([]);
      setSearchComplete(searchTargets.length === 0);
      return;
    }

    const googleMapsApiKey = apiKey;
    let cancelled = false;
    setResolvedSearchTargets([]);
    setSearchComplete(false);

    async function loadSearchTargets() {
      const limitedTargets = searchTargets.slice(0, 10);
      const resolved = await Promise.all(
        limitedTargets.map(async (target, index) => (
          await resolveSearchTarget(target, googleMapsApiKey)
        ) ?? resolvedTargetFromFallback(target, index))
      );
      if (cancelled) return;
      setResolvedSearchTargets(resolved.filter((target): target is ResolvedSearchTarget => Boolean(target)));
      setSearchComplete(true);
    }

    loadSearchTargets();

    return () => {
      cancelled = true;
    };
  }, [enabled, searchTargetSignature, searchTargets]);

  useEffect(() => {
    setReady(false);
    setFailed(false);
    setCurrentZoom(null);

    const apiKey = GOOGLE_MAPS_API_KEY;
    const container = containerRef.current;
    if (!enabled || waitingForSearch || !apiKey || displayAtlas.points.length === 0 || !container) return;
    const mapContainer: HTMLDivElement = container;

    const googleMapsApiKey = apiKey;
    let cancelled = false;
    let resizeObserver: ResizeObserver | undefined;
    let fallbackTimer: number | undefined;
    let polylines: google.maps.Polyline[] = [];
    let markers: google.maps.marker.AdvancedMarkerElement[] = [];
    let mapListeners: google.maps.MapsEventListener[] = [];
    let cleanupHandlers: (() => void)[] = [];

    const cleanupMapObjects = () => {
      markerControllerRef.current = null;
      mapListeners.forEach((listener) => listener.remove());
      mapListeners = [];
      cleanupHandlers.forEach((cleanupHandler) => cleanupHandler());
      cleanupHandlers = [];
      polylines.forEach((polyline) => polyline.setMap(null));
      polylines = [];
      markers.forEach((marker) => {
        marker.map = null;
      });
      markers = [];
    };

    const fail = () => {
      if (cancelled) return;
      cancelled = true;
      if (fallbackTimer) window.clearTimeout(fallbackTimer);
      cleanupMapObjects();
      mapContainer.replaceChildren();
      mapRef.current = null;
      setFailed(true);
    };

    async function loadMap() {
      try {
        configureGoogleMaps(googleMapsApiKey);
        const [{ Map }, { AdvancedMarkerElement }] = await Promise.all([
          importLibrary('maps'),
          importLibrary('marker'),
        ]);
        if (cancelled || !mapContainer.isConnected) return;

        const map = new Map(mapContainer, {
          backgroundColor: '#EFE5D8',
          center: centerFor(displayAtlas),
          clickableIcons: interactive,
          disableDefaultUI: !interactive,
          fullscreenControl: interactive,
          gestureHandling: interactive ? 'auto' : 'none',
          keyboardShortcuts: interactive,
          mapId: GOOGLE_MAPS_MAP_ID || undefined,
          mapTypeControl: false,
          streetViewControl: false,
          zoom: displayAtlas.points.length === 1 ? 11 : 6,
          zoomControl: interactive && !useCustomZoomControls,
        });

        mapRef.current = map;
        fallbackTimer = window.setTimeout(fail, 15000);
        const syncZoom = () => {
          const zoom = map.getZoom();
          setCurrentZoom(typeof zoom === 'number' ? zoom : null);
        };
        mapListeners.push(map.addListener('zoom_changed', syncZoom));

        if (showLines && routeSegments.length) {
          polylines = addRouteLines(map, routeSegments, variant);
        }
        const markerResult = addPointMarkers(map, AdvancedMarkerElement, points, variant);
        markers = markerResult.markers;
        cleanupHandlers = markerResult.cleanupHandlers;
        markerControllerRef.current = markerResult;

        const fitListener = fitMap(map, displayAtlas, variant);
        if (fitListener) mapListeners.push(fitListener);
        mapListeners.push(google.maps.event.addListenerOnce(map, 'idle', () => {
          if (cancelled) return;
          if (fallbackTimer) window.clearTimeout(fallbackTimer);
          syncZoom();
          setReady(true);
        }));

        if (typeof ResizeObserver !== 'undefined') {
          resizeObserver = new ResizeObserver(() => {
            const center = map.getCenter();
            google.maps.event.trigger(map, 'resize');
            if (center) map.setCenter(center);
          });
          resizeObserver.observe(mapContainer);
        }
      } catch {
        fail();
      }
    }

    loadMap();

    return () => {
      cancelled = true;
      if (fallbackTimer) window.clearTimeout(fallbackTimer);
      resizeObserver?.disconnect();
      cleanupMapObjects();
      mapContainer.replaceChildren();
      mapRef.current = null;
      setCurrentZoom(null);
    };
  }, [displayAtlas, enabled, interactive, points, routeSegments, showLines, useCustomZoomControls, variant, waitingForSearch]);

  useEffect(() => {
    if (!focusRequest || handledFocusNonceRef.current === focusRequest.nonce) return;
    if (markerControllerRef.current?.focusPoint(focusRequest)) {
      handledFocusNonceRef.current = focusRequest.nonce;
    }
  }, [focusRequest, points, ready]);

  useEffect(() => {
    if (!viewAllRequest || handledViewAllNonceRef.current === viewAllRequest.nonce || !ready) return;
    const map = mapRef.current;
    if (!map || displayAtlas.points.length === 0) return;

    markerControllerRef.current?.clearSelection();
    fitMap(map, displayAtlas, variant);
    google.maps.event.addListenerOnce(map, 'idle', () => {
      const zoom = map.getZoom();
      setCurrentZoom(typeof zoom === 'number' ? zoom : null);
    });
    handledViewAllNonceRef.current = viewAllRequest.nonce;
  }, [displayAtlas, ready, variant, viewAllRequest]);

  return (
    <div
      className={[
        'itinerary-map',
        `itinerary-map-${variant}`,
        ready ? 'is-ready' : '',
        showFallback ? 'is-fallback' : '',
        showDeferred ? 'is-deferred' : '',
        className ?? '',
      ].filter(Boolean).join(' ')}
      aria-label={title}
      role={interactive ? 'group' : 'img'}
    >
      {showDeferred ? (
        <div className="itinerary-map-deferred" aria-hidden="true" />
      ) : showFallback ? (
        fallbackNode ?? errorNode
      ) : failed ? (
        fallbackNode ?? errorNode
      ) : (
        <>
          <div ref={containerRef} className="itinerary-map-canvas" />
          {showCustomZoomControls ? (
            <div className="itinerary-map-zoom-controls" aria-label="Map zoom controls">
              <button
                type="button"
                className="itinerary-map-zoom-button"
                aria-label="Zoom in"
                title="Zoom in"
                disabled={currentZoom !== null && currentZoom >= MAX_MAP_ZOOM}
                onClick={() => zoomMap(1)}
              >
                +
              </button>
              <button
                type="button"
                className="itinerary-map-zoom-button"
                aria-label="Zoom out"
                title="Zoom out"
                disabled={currentZoom !== null && currentZoom <= MIN_MAP_ZOOM}
                onClick={() => zoomMap(-1)}
              >
                -
              </button>
            </div>
          ) : null}
          {!ready && (
            <div className="itinerary-map-loading" role="status" aria-live="polite">
              <div className="itinerary-map-loading-panel">
                <span className="itinerary-map-loading-label">{effectiveLoadingLabel}</span>
                {effectiveLoadingHint ? <span className="itinerary-map-loading-hint">{effectiveLoadingHint}</span> : null}
                <span className="itinerary-map-loading-bar" aria-hidden="true" />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
