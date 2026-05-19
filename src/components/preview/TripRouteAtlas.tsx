'use client';

import { useMemo } from 'react';
import type { TripRouteAtlas, TripRouteAtlasLeg, TripRouteAtlasPoint } from '@/lib/trip-route';

const VIEWBOX_WIDTH = 1000;
const VIEWBOX_HEIGHT = 1400;
const PAD_X = 105;
const PAD_Y = 130;

interface ProjectedPoint extends TripRouteAtlasPoint {
  x: number;
  y: number;
  labelSide: 'left' | 'right';
}

function projectAtlas(atlas: TripRouteAtlas): ProjectedPoint[] {
  const midLat = (atlas.bounds.minLat + atlas.bounds.maxLat) / 2;
  const lngFactor = Math.cos((midLat * Math.PI) / 180) || 1;
  const raw = atlas.points.map((point) => ({
    ...point,
    px: point.lng * lngFactor,
    py: point.lat,
  }));
  const minX = Math.min(...raw.map((point) => point.px));
  const maxX = Math.max(...raw.map((point) => point.px));
  const minY = Math.min(...raw.map((point) => point.py));
  const maxY = Math.max(...raw.map((point) => point.py));
  const spanX = Math.max(maxX - minX, 0.01);
  const spanY = Math.max(maxY - minY, 0.01);
  const scaleX = (VIEWBOX_WIDTH - PAD_X * 2) / spanX;
  const scaleY = (VIEWBOX_HEIGHT - PAD_Y * 2) / spanY;

  return raw.map((point, index) => {
    const x = PAD_X + (point.px - minX) * scaleX;
    const y = VIEWBOX_HEIGHT - PAD_Y - (point.py - minY) * scaleY;
    const labelSide = x > VIEWBOX_WIDTH * 0.58 ? 'left' : 'right';
    return {
      ...point,
      index,
      x,
      y,
      labelSide,
    };
  });
}

function pathForLeg(from: ProjectedPoint, to: ProjectedPoint, leg: TripRouteAtlasLeg, index: number): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
  const bendBase = leg.mode === 'ferry' || leg.mode === 'flight' ? 48 : 24;
  const bend = bendBase * (index % 2 === 0 ? 1 : -1);
  const cx = (from.x + to.x) / 2 + (-dy / distance) * bend;
  const cy = (from.y + to.y) / 2 + (dx / distance) * bend;
  return `M ${from.x.toFixed(1)} ${from.y.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${to.x.toFixed(1)} ${to.y.toFixed(1)}`;
}

function labelWidth(label: string): number {
  return Math.max(64, Math.min(176, label.length * 7 + 28));
}

function markerText(point: ProjectedPoint, hasHomeStart: boolean): string {
  if (point.role === 'home') return '';
  return String(hasHomeStart ? point.index : point.index + 1);
}

function modeLabel(mode: string): string {
  switch (mode) {
    case 'car':
      return 'drive';
    case 'train':
      return 'rail';
    case 'ferry':
      return 'ferry';
    case 'walk':
      return 'walk';
    case 'flight':
      return 'flight';
    default:
      return 'route';
  }
}

export default function TripRouteAtlas({ atlas }: { atlas: TripRouteAtlas }) {
  const points = useMemo(() => projectAtlas(atlas), [atlas]);
  const hasHomeStart = points[0]?.role === 'home';

  return (
    <div className="route-atlas-stage" aria-label="Trip route map">
      <svg className="route-atlas-svg" viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`} role="img">
        <title>Trip route map</title>
        <defs>
          <pattern id="route-atlas-paper" width="72" height="72" patternUnits="userSpaceOnUse">
            <rect width="72" height="72" fill="#F4EDE2" />
            <path d="M0 71.5H72M71.5 0V72" stroke="#E8E1D6" strokeWidth="1" opacity="0.38" />
          </pattern>
          <filter id="route-atlas-paper-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="16" stdDeviation="20" floodColor="#1A1410" floodOpacity="0.14" />
          </filter>
        </defs>

        <rect x="28" y="28" width="944" height="1344" rx="8" fill="#FBF7F1" filter="url(#route-atlas-paper-shadow)" />
        <rect x="52" y="52" width="896" height="1296" rx="4" fill="url(#route-atlas-paper)" />
        <path className="route-atlas-coast route-atlas-coast-a" d="M102 230 C255 124 392 168 492 114 C640 36 804 90 900 210 L900 1192 C758 1290 598 1218 462 1270 C318 1325 186 1260 102 1166 Z" />
        <path className="route-atlas-coast route-atlas-coast-b" d="M154 356 C306 286 426 324 544 270 C684 206 800 254 858 360 L858 1018 C724 1094 598 1048 456 1118 C306 1192 210 1118 154 1012 Z" />

        <g className="route-atlas-grid">
          {Array.from({ length: 5 }).map((_, index) => {
            const x = 160 + index * 170;
            return <path key={`v-${x}`} d={`M ${x} 92 L ${x} 1308`} />;
          })}
          {Array.from({ length: 6 }).map((_, index) => {
            const y = 150 + index * 205;
            return <path key={`h-${y}`} d={`M 92 ${y} L 908 ${y}`} />;
          })}
        </g>

        <g className="route-atlas-legs">
          {atlas.legs.map((leg, index) => {
            const from = points[leg.from];
            const to = points[leg.to];
            if (!from || !to) return null;
            return (
              <path
                key={`${leg.from}-${leg.to}-${index}`}
                className={`route-atlas-leg route-atlas-leg-${leg.mode}`}
                d={pathForLeg(from, to, leg, index)}
              />
            );
          })}
        </g>

        <g className="route-atlas-points">
          {points.map((point) => {
            const isHome = point.role === 'home';
            const number = markerText(point, hasHomeStart);
            const width = labelWidth(point.label);
            const labelX = point.labelSide === 'right' ? 18 : -width - 18;
            const labelY = point.index % 2 === 0 ? -38 : 15;
            return (
              <g
                key={point.id}
                className={`route-atlas-point ${isHome ? 'route-atlas-point-home' : ''}`}
                transform={`translate(${point.x.toFixed(1)} ${point.y.toFixed(1)})`}
              >
                <line className="route-atlas-label-rule" x1="0" y1="0" x2={point.labelSide === 'right' ? 18 : -18} y2={labelY + 14} />
                <rect className="route-atlas-label-bg" x={labelX} y={labelY} width={width} height="30" rx="3" />
                <text className="route-atlas-label" x={labelX + 12} y={labelY + 19}>
                  {point.label}
                </text>
                <circle className="route-atlas-marker-halo" r={isHome ? 9 : 15} />
                <circle className="route-atlas-marker" r={isHome ? 5 : 11} />
                {number ? (
                  <text className="route-atlas-marker-number" y="4">
                    {number}
                  </text>
                ) : null}
              </g>
            );
          })}
        </g>

        {atlas.modes.length > 1 ? (
          <g className="route-atlas-legend" transform="translate(86 1288)">
            {atlas.modes.slice(0, 5).map((mode, index) => (
              <g key={mode} transform={`translate(${index * 132} 0)`}>
                <path className={`route-atlas-leg route-atlas-leg-${mode}`} d="M 0 0 L 42 0" />
                <text x="54" y="4">{modeLabel(mode)}</text>
              </g>
            ))}
          </g>
        ) : null}
      </svg>
    </div>
  );
}
