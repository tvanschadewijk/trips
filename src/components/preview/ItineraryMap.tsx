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

type ResolvedSearchTarget = {
  point: TripRouteAtlasPoint;
  detail: ItineraryMapPointDetail;
};

const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
const GOOGLE_MAPS_MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID;
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
  });
  if (SEARCH_CACHE.has(cacheKey)) return SEARCH_CACHE.get(cacheKey) ?? null;

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

function fitMap(map: google.maps.Map, atlas: TripRouteAtlas, variant: MapVariant): google.maps.MapsEventListener | undefined {
  if (atlas.points.length === 1) {
    map.setCenter(toLatLng(atlas.points[0]));
    map.setZoom(variant === 'overview-card' ? 9 : 12);
    return undefined;
  }

  const bounds = new google.maps.LatLngBounds(
    { lat: atlas.bounds.minLat, lng: atlas.bounds.minLng },
    { lat: atlas.bounds.maxLat, lng: atlas.bounds.maxLng }
  );

  map.fitBounds(
    bounds,
    variant === 'overview-card'
      ? { top: 28, right: 24, bottom: 28, left: 24 }
      : { top: 72, right: 64, bottom: 72, left: 64 }
  );

  const maxZoom = variant === 'overview-card' ? 8.4 : 13;
  return google.maps.event.addListenerOnce(map, 'idle', () => {
    const zoom = map.getZoom();
    if (zoom && zoom > maxZoom) map.setZoom(maxZoom);
  });
}

function popupContentFor(point: PointDisplay): HTMLElement {
  const popup = document.createElement('div');
  popup.className = 'itinerary-map-stop-popup';

  if (point.detail.kicker) {
    const kicker = document.createElement('div');
    kicker.className = 'itinerary-map-stop-popup-kicker';
    kicker.textContent = point.detail.kicker;
    popup.append(kicker);
  }

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
    const baseOptions: google.maps.PolylineOptions = {
      clickable: false,
      geodesic: true,
      map,
      path: segment.path,
    };
    const casing = new google.maps.Polyline({
      ...baseOptions,
      strokeColor: '#FBF7F1',
      strokeOpacity: 0.92,
      strokeWeight: variant === 'overview-card' ? 7 : 10,
      zIndex: 1,
    });
    const line = new google.maps.Polyline({
      ...baseOptions,
      strokeColor: routeColorFor(segment.mode),
      strokeOpacity: 0.96,
      strokeWeight: variant === 'overview-card' ? 4 : 6,
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
) {
  const infoWindow = new google.maps.InfoWindow({
    disableAutoPan: variant === 'overview-card',
    headerDisabled: true,
    maxWidth: variant === 'overview-card' ? 220 : 280,
    pixelOffset: new google.maps.Size(0, -8),
  });
  const cleanupHandlers: (() => void)[] = [];
  const mapClickListener = map.addListener('click', () => infoWindow.close());
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
    const showPopup = () => {
      infoWindow.setContent(popupContentFor(point));
      infoWindow.open({ anchor: marker, map, shouldFocus: false });
    };
    const closePopup = () => infoWindow.close();
    const stopAndShowPopup = (event: Event) => {
      event.stopPropagation();
      showPopup();
    };

    content.addEventListener('mouseenter', showPopup);
    content.addEventListener('mousemove', showPopup);
    content.addEventListener('mouseleave', closePopup);
    content.addEventListener('click', stopAndShowPopup);
    marker.addEventListener('gmp-click', showPopup);
    cleanupHandlers.push(() => {
      content.removeEventListener('mouseenter', showPopup);
      content.removeEventListener('mousemove', showPopup);
      content.removeEventListener('mouseleave', closePopup);
      content.removeEventListener('click', stopAndShowPopup);
      marker.removeEventListener('gmp-click', showPopup);
    });

    return marker;
  });

  cleanupHandlers.push(() => {
    mapClickListener.remove();
    infoWindow.close();
  });

  return { markers, cleanupHandlers };
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
}: ItineraryMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
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
          zoomControl: interactive,
        });

        mapRef.current = map;
        fallbackTimer = window.setTimeout(fail, 15000);

        if (showLines && routeSegments.length) {
          polylines = addRouteLines(map, routeSegments, variant);
        }
        const markerResult = addPointMarkers(map, AdvancedMarkerElement, points, variant);
        markers = markerResult.markers;
        cleanupHandlers = markerResult.cleanupHandlers;

        const fitListener = fitMap(map, displayAtlas, variant);
        if (fitListener) mapListeners.push(fitListener);
        mapListeners.push(google.maps.event.addListenerOnce(map, 'idle', () => {
          if (cancelled) return;
          if (fallbackTimer) window.clearTimeout(fallbackTimer);
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
    };
  }, [displayAtlas, enabled, interactive, points, routeSegments, showLines, variant, waitingForSearch]);

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
      role="img"
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
