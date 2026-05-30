'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { FeatureCollection, LineString, Point } from 'geojson';
import type { TripRouteAtlas } from '@/lib/trip-route';
import 'mapbox-gl/dist/mapbox-gl.css';
import '@/styles/itinerary-map.css';

type MapVariant = 'overview-card' | 'day';

interface MapboxItineraryMapProps {
  atlas: TripRouteAtlas;
  title: string;
  variant?: MapVariant;
  interactive?: boolean;
  fallback?: ReactNode;
  className?: string;
  pointDetails?: Record<string, MapboxPointDetail>;
  showLines?: boolean;
  enabled?: boolean;
}

export interface MapboxPointDetail {
  title?: string;
  kicker?: string;
  body?: string;
}

type RouteFeatureCollection = FeatureCollection<LineString, { mode: string }>;
type PointFeatureCollection = FeatureCollection<Point, {
  id: string;
  label: string;
  marker: string;
  role: string;
  detailTitle: string;
  detailKicker: string;
  detailBody: string;
}>;
type MapboxControl = { disable: () => void };
type MapboxFeature = {
  geometry?: { type: string; coordinates?: [number, number] };
  properties?: Record<string, string>;
};
type MapboxLayerEvent = {
  features?: MapboxFeature[];
};
type MapboxPopup = {
  addTo: (map: MapboxMap) => MapboxPopup;
  remove: () => void;
  setHTML: (html: string) => MapboxPopup;
  setLngLat: (lngLat: [number, number]) => MapboxPopup;
};
type MapboxMap = {
  addLayer: (layer: Record<string, unknown>) => void;
  addSource: (id: string, source: Record<string, unknown>) => void;
  boxZoom: MapboxControl;
  doubleClickZoom: MapboxControl;
  dragPan: MapboxControl;
  dragRotate: MapboxControl;
  fitBounds: (bounds: [[number, number], [number, number]], options: Record<string, unknown>) => void;
  getCanvas: () => HTMLCanvasElement;
  isStyleLoaded: () => boolean;
  jumpTo: (options: Record<string, unknown>) => void;
  keyboard: MapboxControl;
  on: (event: string, handlerOrLayer: string | ((event: { error?: { status?: number } }) => void), handler?: (event: MapboxLayerEvent) => void) => void;
  remove: () => void;
  resize: () => void;
  scrollZoom: MapboxControl;
  touchZoomRotate: MapboxControl;
};
type MapboxModule = {
  default: {
    accessToken: string;
    Map: new (options: Record<string, unknown>) => MapboxMap;
    Popup: new (options: Record<string, unknown>) => MapboxPopup;
  };
};

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
const MAP_STYLE = 'mapbox://styles/mapbox/streets-v12';

function lineDataFor(atlas: TripRouteAtlas): RouteFeatureCollection {
  const features = atlas.legs
    .map((leg) => {
      const from = atlas.points[leg.from];
      const to = atlas.points[leg.to];
      if (!from || !to) return undefined;
      return {
        type: 'Feature' as const,
        properties: { mode: leg.mode || 'route' },
        geometry: {
          type: 'LineString' as const,
          coordinates: [
            [from.lng, from.lat],
            [to.lng, to.lat],
          ],
        },
      };
    })
    .filter((feature): feature is RouteFeatureCollection['features'][number] => Boolean(feature));

  if (!features.length && atlas.points.length > 1) {
    features.push({
      type: 'Feature',
      properties: { mode: 'route' },
      geometry: {
        type: 'LineString',
        coordinates: atlas.points.map((point) => [point.lng, point.lat]),
      },
    });
  }

  return {
    type: 'FeatureCollection',
    features,
  };
}

function pointDataFor(atlas: TripRouteAtlas, pointDetails?: Record<string, MapboxPointDetail>): PointFeatureCollection {
  const hasHomeStart = atlas.points[0]?.role === 'home';
  return {
    type: 'FeatureCollection',
    features: atlas.points.map((point) => ({
      type: 'Feature',
      properties: {
        id: point.id,
        label: point.label,
        marker: point.role === 'home' ? '' : String(hasHomeStart ? point.index : point.index + 1),
        role: point.role ?? 'stop',
        detailTitle: pointDetails?.[point.id]?.title ?? point.label,
        detailKicker: pointDetails?.[point.id]?.kicker ?? '',
        detailBody: pointDetails?.[point.id]?.body ?? '',
      },
      geometry: {
        type: 'Point',
        coordinates: [point.lng, point.lat],
      },
    })),
  };
}

function centerFor(atlas: TripRouteAtlas): [number, number] {
  return [
    (atlas.bounds.minLng + atlas.bounds.maxLng) / 2,
    (atlas.bounds.minLat + atlas.bounds.maxLat) / 2,
  ];
}

function fitMap(map: MapboxMap, atlas: TripRouteAtlas, variant: MapVariant) {
  if (atlas.points.length === 1) {
    map.jumpTo({
      center: [atlas.points[0].lng, atlas.points[0].lat],
      zoom: variant === 'overview-card' ? 9 : 12,
    });
    return;
  }

  const bounds: [[number, number], [number, number]] = [
    [atlas.bounds.minLng, atlas.bounds.minLat],
    [atlas.bounds.maxLng, atlas.bounds.maxLat],
  ];

  map.fitBounds(
    bounds,
    {
      duration: 0,
      maxZoom: variant === 'overview-card' ? 8.4 : 13,
      padding: variant === 'overview-card'
        ? { top: 28, right: 24, bottom: 28, left: 24 }
        : { top: 72, right: 64, bottom: 72, left: 64 },
    }
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function popupHtml(properties: Record<string, string> | undefined): string {
  const title = properties?.detailTitle || properties?.label || 'Stop';
  const kicker = properties?.detailKicker;
  const body = properties?.detailBody;

  return [
    '<div class="mapbox-stop-popup">',
    kicker ? `<div class="mapbox-stop-popup-kicker">${escapeHtml(kicker)}</div>` : '',
    `<div class="mapbox-stop-popup-title">${escapeHtml(title)}</div>`,
    body ? `<div class="mapbox-stop-popup-body">${escapeHtml(body)}</div>` : '',
    '</div>',
  ].join('');
}

function addMapLayers(
  map: MapboxMap,
  mapboxgl: MapboxModule['default'],
  ids: { route: string; points: string },
  variant: MapVariant,
  routeData: RouteFeatureCollection,
  pointData: PointFeatureCollection,
  showLines: boolean
) {
  if (showLines && routeData.features.length) {
    map.addSource(ids.route, { type: 'geojson', data: routeData });
    map.addLayer({
      id: `${ids.route}-casing`,
      type: 'line',
      source: ids.route,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#FBF7F1',
        'line-width': variant === 'overview-card' ? 7 : 10,
        'line-opacity': 0.9,
      },
    });
    map.addLayer({
      id: `${ids.route}-line`,
      type: 'line',
      source: ids.route,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': [
          'match',
          ['get', 'mode'],
          'walk',
          '#9B4F2E',
          'train',
          '#1A1410',
          'ferry',
          '#2F6B4A',
          'flight',
          '#6B6157',
          '#C14F2A',
        ],
        'line-width': variant === 'overview-card' ? 4 : 6,
        'line-opacity': 0.96,
      },
    });
  }

  map.addSource(ids.points, { type: 'geojson', data: pointData });
  map.addLayer({
    id: `${ids.points}-hit`,
    type: 'circle',
    source: ids.points,
    paint: {
      'circle-radius': variant === 'overview-card' ? 18 : 22,
      'circle-color': '#FFFFFF',
      'circle-opacity': 0,
    },
  });
  map.addLayer({
    id: `${ids.points}-halo`,
    type: 'circle',
    source: ids.points,
    paint: {
      'circle-radius': variant === 'overview-card' ? 9 : 12,
      'circle-color': '#FBF7F1',
      'circle-opacity': 0.94,
      'circle-stroke-color': [
        'case',
        ['==', ['get', 'role'], 'home'],
        '#6B6157',
        '#C14F2A',
      ],
      'circle-stroke-width': 2,
    },
  });
  map.addLayer({
    id: `${ids.points}-dot`,
    type: 'circle',
    source: ids.points,
    paint: {
      'circle-radius': variant === 'overview-card' ? 5 : 7,
      'circle-color': [
        'case',
        ['==', ['get', 'role'], 'home'],
        '#6B6157',
        '#C14F2A',
      ],
    },
  });
  map.addLayer({
    id: `${ids.points}-labels`,
    type: 'symbol',
    source: ids.points,
    layout: {
      'text-field': ['get', 'marker'],
      'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
      'text-size': variant === 'overview-card' ? 10 : 12,
      'text-offset': [0, 0],
      'text-anchor': 'center',
      'text-max-width': 9,
      'text-allow-overlap': true,
      'symbol-sort-key': ['to-number', ['get', 'marker'], 0],
    },
    paint: {
      'text-color': '#FBF7F1',
      'text-halo-color': '#C14F2A',
      'text-halo-width': 0.2,
    },
  });

  const popup = new mapboxgl.Popup({
    closeButton: false,
    closeOnClick: false,
    className: 'mapbox-stop-popup-shell',
    offset: 16,
  });
  const hitLayerId = `${ids.points}-hit`;

  const showPopup = (event: MapboxLayerEvent) => {
    const feature = event.features?.[0];
    const coordinates = feature?.geometry?.coordinates;
    if (!coordinates) return;
    popup
      .setLngLat([coordinates[0], coordinates[1]])
      .setHTML(popupHtml(feature.properties))
      .addTo(map);
  };

  map.on('mouseenter', hitLayerId, (event) => {
    map.getCanvas().style.cursor = 'pointer';
    showPopup(event);
  });
  map.on('mousemove', hitLayerId, showPopup);
  map.on('mouseleave', hitLayerId, () => {
    map.getCanvas().style.cursor = '';
    popup.remove();
  });
  map.on('click', hitLayerId, showPopup);
}

export default function MapboxItineraryMap({
  atlas,
  title,
  variant = 'day',
  interactive = false,
  fallback,
  className,
  pointDetails,
  showLines = variant !== 'day',
  enabled = true,
}: MapboxItineraryMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const idRef = useRef(`itinerary-map-${Math.random().toString(36).slice(2)}`);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const routeData = useMemo(() => lineDataFor(atlas), [atlas]);
  const pointData = useMemo(() => pointDataFor(atlas, pointDetails), [atlas, pointDetails]);
  const showFallback = !MAPBOX_TOKEN || atlas.points.length === 0;
  const showDeferred = !enabled && !showFallback;
  const fallbackNode = fallback ? <div className="mapbox-fallback">{fallback}</div> : null;

  useEffect(() => {
    setReady(false);
    setFailed(false);

    const mapboxToken = MAPBOX_TOKEN;
    if (!enabled || !mapboxToken || atlas.points.length === 0 || !containerRef.current) return;
    const resolvedMapboxToken: string = mapboxToken;

    let cancelled = false;
    let resizeObserver: ResizeObserver | undefined;
    let fallbackTimer: number | undefined;

    async function loadMap() {
      try {
        const mapboxgl = ((await import('mapbox-gl')) as unknown as MapboxModule).default;
        if (cancelled || !containerRef.current) return;

        mapboxgl.accessToken = resolvedMapboxToken;
        const sourceIds = {
          route: `${idRef.current}-route`,
          points: `${idRef.current}-points`,
        };
        const map = new mapboxgl.Map({
          container: containerRef.current,
          style: MAP_STYLE,
          center: centerFor(atlas),
          zoom: atlas.points.length === 1 ? 11 : 6,
          interactive,
          attributionControl: true,
          cooperativeGestures: false,
          fadeDuration: 0,
          logoPosition: 'bottom-left',
        });

        mapRef.current = map;
        fallbackTimer = window.setTimeout(() => {
          if (cancelled) return;
          cancelled = true;
          map.remove();
          mapRef.current = null;
          setFailed(true);
        }, 15000);

        if (!interactive) {
          map.boxZoom.disable();
          map.doubleClickZoom.disable();
          map.dragPan.disable();
          map.dragRotate.disable();
          map.keyboard.disable();
          map.scrollZoom.disable();
          map.touchZoomRotate.disable();
        }

        const fail = () => {
          if (cancelled) return;
          cancelled = true;
          if (fallbackTimer) window.clearTimeout(fallbackTimer);
          map.remove();
          mapRef.current = null;
          setFailed(true);
        };

        map.on('error', (event) => {
          const status = (event.error as { status?: number } | undefined)?.status;
          if (status === 401 || status === 403) fail();
        });

        map.on('load', () => {
          if (cancelled) return;
          try {
            if (fallbackTimer) window.clearTimeout(fallbackTimer);
            map.resize();
            addMapLayers(map, mapboxgl, sourceIds, variant, routeData, pointData, showLines);
            fitMap(map, atlas, variant);
            setReady(true);
          } catch {
            fail();
          }
        });

        if (typeof ResizeObserver !== 'undefined' && containerRef.current) {
          resizeObserver = new ResizeObserver(() => map.resize());
          resizeObserver.observe(containerRef.current);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    }

    loadMap();

    return () => {
      cancelled = true;
      if (fallbackTimer) window.clearTimeout(fallbackTimer);
      resizeObserver?.disconnect();
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [atlas, enabled, interactive, pointData, routeData, showLines, variant]);

  return (
    <div
      className={[
        'mapbox-itinerary-map',
        `mapbox-itinerary-map-${variant}`,
        ready ? 'is-ready' : '',
        showFallback ? 'is-fallback' : '',
        showDeferred ? 'is-deferred' : '',
        className ?? '',
      ].filter(Boolean).join(' ')}
      aria-label={title}
      role="img"
    >
      {showDeferred ? (
        <div className="mapbox-map-deferred" aria-hidden="true" />
      ) : showFallback ? (
        fallbackNode
      ) : failed ? (
        <div className="mapbox-map-error">
          <span>Map could not load</span>
        </div>
      ) : (
        <>
          <div ref={containerRef} className="mapbox-map-canvas" />
          {!ready && <div className="mapbox-map-loading" aria-hidden="true"><span>Loading map</span></div>}
        </>
      )}
    </div>
  );
}
