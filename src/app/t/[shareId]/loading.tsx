'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

interface CachedTrip {
  heroImage?: string;
}

function readCache(shareId: string | undefined): CachedTrip {
  if (!shareId || typeof window === 'undefined') return {};
  try {
    const raw = sessionStorage.getItem(`vt-trip-${shareId}`);
    if (!raw) return {};
    return JSON.parse(raw) as CachedTrip;
  } catch {
    return {};
  }
}

/**
 * Loading state shown while /t/[shareId] is server-rendering.
 *
 * Renders only the cached hero photo + overlay so the dashboard's
 * view-transition lands on a real image. The page content (title, paper
 * card, overview) is intentionally NOT skeletoned — it would appear and
 * be replaced almost instantly, which is jarring. Instead the production
 * trip view fades its hero body in when it mounts (.hero-body
 * animation in preview.css), which feels calmer.
 *
 * If the page takes longer than ~500ms a small Fraunces italic 'Loading'
 * label appears at the bottom so the user knows we haven't stalled.
 */
export default function LoadingTripPage() {
  const params = useParams<{ shareId: string }>();
  const shareId = params?.shareId;

  const trip = readCache(shareId);
  const [showLabel, setShowLabel] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setShowLabel(true), 500);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      style={{
        minHeight: '100dvh',
        background: '#FBF7F1',
        display: 'flex',
        justifyContent: 'center',
        padding: '0 16px',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 430,
          minHeight: '100dvh',
          position: 'relative',
          overflow: 'hidden',
          background: '#1A1410',
        }}
      >
        {trip.heroImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={trip.heroImage}
            alt=""
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              viewTransitionName: 'trip-hero',
            } as React.CSSProperties}
          />
        ) : (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(135deg, #2A1F18 0%, #1A1410 100%)',
              viewTransitionName: 'trip-hero',
            } as React.CSSProperties}
          />
        )}

        <div
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'linear-gradient(to top, rgba(26,20,16,0.35) 0%, rgba(26,20,16,0.18) 35%, rgba(26,20,16,0.06) 65%, transparent 100%)',
          }}
        />

        {showLabel && (
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 'calc(40px + env(safe-area-inset-bottom))',
              textAlign: 'center',
              fontFamily: '"Fraunces", "Iowan Old Style", "Palatino", Georgia, serif',
              fontStyle: 'italic',
              fontSize: 14,
              fontWeight: 360,
              color: 'rgba(251, 247, 241, 0.78)',
              textShadow: '0 1px 2px rgba(0,0,0,0.4)',
              animation: 'loading-fade-in 200ms ease-out both',
            }}
          >
            Loading…
          </div>
        )}
      </div>
    </div>
  );
}
