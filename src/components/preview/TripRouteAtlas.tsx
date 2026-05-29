'use client';

import type { TripRouteAtlas as TripRouteAtlasData } from '@/lib/trip-route';

interface TripRouteAtlasProps {
  atlas: TripRouteAtlasData;
  className?: string;
}

const VIEWBOX = {
  width: 1000,
  height: 1400,
  paddingX: 112,
  paddingY: 132,
};

function projectPoint(point: TripRouteAtlasData['points'][number], atlas: TripRouteAtlasData) {
  const lngSpan = Math.max(atlas.bounds.maxLng - atlas.bounds.minLng, 0.01);
  const latSpan = Math.max(atlas.bounds.maxLat - atlas.bounds.minLat, 0.01);
  const mapWidth = VIEWBOX.width - VIEWBOX.paddingX * 2;
  const mapHeight = VIEWBOX.height - VIEWBOX.paddingY * 2;

  return {
    ...point,
    x: VIEWBOX.paddingX + ((point.lng - atlas.bounds.minLng) / lngSpan) * mapWidth,
    y: VIEWBOX.height - VIEWBOX.paddingY - ((point.lat - atlas.bounds.minLat) / latSpan) * mapHeight,
  };
}

function curvedPath(
  from: ReturnType<typeof projectPoint>,
  to: ReturnType<typeof projectPoint>,
  index: number
) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.max(Math.hypot(dx, dy), 1);
  const bend = Math.min(82, distance * 0.16) * (index % 2 === 0 ? 1 : -1);
  const controlX = (from.x + to.x) / 2 + (-dy / distance) * bend;
  const controlY = (from.y + to.y) / 2 + (dx / distance) * bend;

  return `M ${from.x.toFixed(1)} ${from.y.toFixed(1)} Q ${controlX.toFixed(1)} ${controlY.toFixed(1)} ${to.x.toFixed(1)} ${to.y.toFixed(1)}`;
}

function labelFor(point: ReturnType<typeof projectPoint>) {
  const alignRight = point.x < VIEWBOX.width * 0.58;
  const labelX = point.x + (alignRight ? 26 : -26);
  const labelY = Math.max(70, Math.min(VIEWBOX.height - 70, point.y - 18));
  const width = Math.min(260, Math.max(86, point.label.length * 8.2 + 26));
  const rectX = alignRight ? labelX - 10 : labelX - width + 10;

  return {
    anchor: alignRight ? 'start' : 'end',
    labelX,
    labelY,
    rectX,
    rectY: labelY - 25,
    width,
  };
}

export default function TripRouteAtlas({ atlas, className }: TripRouteAtlasProps) {
  const points = atlas.points.map((point) => projectPoint(point, atlas));
  const hasHomeStart = atlas.points[0]?.role === 'home';

  return (
    <div className={['route-atlas-stage', className ?? ''].filter(Boolean).join(' ')}>
      <svg className="route-atlas-svg" viewBox={`0 0 ${VIEWBOX.width} ${VIEWBOX.height}`} aria-hidden="true">
        <path
          className="route-atlas-coast"
          d="M 96 186 C 222 104 342 164 438 126 C 568 74 650 152 748 120 C 850 86 910 160 928 272 C 944 374 872 470 906 584 C 944 710 856 798 882 922 C 906 1036 826 1122 852 1254"
        />
        <path
          className="route-atlas-coast route-atlas-coast-b"
          d="M 160 1246 C 264 1178 326 1230 416 1182 C 526 1124 636 1188 732 1138 C 820 1092 878 1152 914 1228"
        />
        <g className="route-atlas-grid">
          {[0, 1, 2, 3].map((line) => (
            <path
              key={`h-${line}`}
              d={`M 96 ${260 + line * 260} C 288 ${224 + line * 260} 708 ${294 + line * 260} 920 ${250 + line * 260}`}
            />
          ))}
          {[0, 1, 2].map((line) => (
            <path
              key={`v-${line}`}
              d={`M ${248 + line * 238} 116 C ${210 + line * 238} 420 ${294 + line * 238} 840 ${244 + line * 238} 1286`}
            />
          ))}
        </g>

        {atlas.legs.map((leg, index) => {
          const from = points[leg.from];
          const to = points[leg.to];
          if (!from || !to) return null;

          return (
            <path
              key={`${leg.from}-${leg.to}-${index}`}
              className={`route-atlas-leg route-atlas-leg-${leg.mode || 'route'}`}
              d={curvedPath(from, to, index)}
            />
          );
        })}

        {points.map((point) => {
          const label = labelFor(point);
          const marker = point.role === 'home' && hasHomeStart ? '' : String(hasHomeStart ? point.index : point.index + 1);

          return (
            <g key={point.id} className={`route-atlas-point route-atlas-point-${point.role ?? 'stop'}`}>
              <line className="route-atlas-label-rule" x1={point.x} y1={point.y - 11} x2={label.labelX} y2={label.labelY - 7} />
              <rect className="route-atlas-label-bg" x={label.rectX} y={label.rectY} width={label.width} height="40" rx="20" />
              <text className="route-atlas-label" x={label.labelX} y={label.labelY} textAnchor={label.anchor} dominantBaseline="middle">
                {point.label}
              </text>
              <circle className="route-atlas-marker-halo" cx={point.x} cy={point.y} r="20" />
              <circle className="route-atlas-marker" cx={point.x} cy={point.y} r="12" />
              {marker ? (
                <text className="route-atlas-marker-number" x={point.x} y={point.y + 4}>
                  {marker}
                </text>
              ) : null}
            </g>
          );
        })}

        {atlas.modes.length ? (
          <g className="route-atlas-legend" transform="translate(88 1330)">
            <text>{atlas.modes.slice(0, 3).join(' / ')}</text>
          </g>
        ) : null}
      </svg>
    </div>
  );
}
