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
}

type RouteFeatureCollection = FeatureCollection<LineString, { mode: string }>;
type PointFeatureCollection = FeatureCollection<Point, { label: string; marker: string; role: string }>;
type MapboxControl = { disable: () => void };
type MapboxMap = {
  addLayer: (layer: Record<string, unknown>) => void;
  addSource: (id: string, source: Record<string, unknown>) => void;
  boxZoom: MapboxControl;
  doubleClickZoom: MapboxControl;
  dragPan: MapboxControl;
  dragRotate: MapboxControl;
  fitBounds: (bounds: [[number, number], [number, number]], options: Record<string, unknown>) => void;
  isStyleLoaded: () => boolean;
  jumpTo: (options: Record<string, unknown>) => void;
  keyboard: MapboxControl;
  on: (event: string, handler: (event: { error?: { status?: number } }) => void) => void;
  remove: () => void;
  resize: () => void;
  scrollZoom: MapboxControl;
  touchZoomRotate: MapboxControl;
};
type MapboxModule = {
  default: {
    accessToken: string;
    Map: new (options: Record<string, unknown>) => MapboxMap;
  };
};

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
const MAP_STYLE = 'mapbox://styles/mapbox/outdoors-v12';

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

function pointDataFor(atlas: TripRouteAtlas): PointFeatureCollection {
  const hasHomeStart = atlas.points[0]?.role === 'home';
  return {
    type: 'FeatureCollection',
    features: atlas.points.map((point) => ({
      type: 'Feature',
      properties: {
        label: point.label,
        marker: point.role === 'home' ? '' : String(hasHomeStart ? point.index : point.index + 1),
        role: point.role ?? 'stop',
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
        : { top: 48, right: 44, bottom: 48, left: 44 },
    }
  );
}

function addRouteLayers(map: MapboxMap, ids: { route: string; points: string }, variant: MapVariant, routeData: RouteFeatureCollection, pointData: PointFeatureCollection) {
  if (routeData.features.length) {
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
      'text-field': variant === 'overview-card' ? ['get', 'marker'] : ['get', 'label'],
      'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
      'text-size': variant === 'overview-card' ? 10 : 12,
      'text-offset': variant === 'overview-card' ? [0, 0] : [0, 1.45],
      'text-anchor': variant === 'overview-card' ? 'center' : 'top',
      'text-max-width': 9,
      'text-allow-overlap': variant === 'overview-card',
      'symbol-sort-key': ['to-number', ['get', 'marker'], 0],
    },
    paint: {
      'text-color': variant === 'overview-card' ? '#FBF7F1' : '#1A1410',
      'text-halo-color': variant === 'overview-card' ? '#C14F2A' : '#FBF7F1',
      'text-halo-width': variant === 'overview-card' ? 0.2 : 1.6,
    },
  });
}

export default function MapboxItineraryMap({
  atlas,
  title,
  variant = 'day',
  interactive = false,
  fallback,
  className,
}: MapboxItineraryMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const idRef = useRef(`itinerary-map-${Math.random().toString(36).slice(2)}`);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const routeData = useMemo(() => lineDataFor(atlas), [atlas]);
  const pointData = useMemo(() => pointDataFor(atlas), [atlas]);
  const showFallback = failed || !MAPBOX_TOKEN || atlas.points.length === 0;
  const fallbackNode = fallback ? <div className="mapbox-fallback">{fallback}</div> : null;

  useEffect(() => {
    setReady(false);
    setFailed(false);

    const mapboxToken = MAPBOX_TOKEN;
    if (!mapboxToken || atlas.points.length === 0 || !containerRef.current) return;
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
        }, 6000);

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
            addRouteLayers(map, sourceIds, variant, routeData, pointData);
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
  }, [atlas, interactive, pointData, routeData, variant]);

  return (
    <div
      className={[
        'mapbox-itinerary-map',
        `mapbox-itinerary-map-${variant}`,
        ready ? 'is-ready' : '',
        showFallback ? 'is-fallback' : '',
        className ?? '',
      ].filter(Boolean).join(' ')}
      aria-label={title}
      role="img"
    >
      {showFallback ? (
        fallbackNode
      ) : (
        <>
          {!ready ? fallbackNode : null}
          <div ref={containerRef} className="mapbox-map-canvas" />
          {!ready && !fallbackNode && <div className="mapbox-map-loading" aria-hidden="true" />}
        </>
      )}
    </div>
  );
}
