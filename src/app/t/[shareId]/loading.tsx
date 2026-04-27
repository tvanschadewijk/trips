'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';

interface CachedTrip {
  heroImage?: string;
  name?: string;
  subtitle?: string;
  start?: string;
  end?: string;
}

function formatDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso + 'T12:00:00');
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
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

export default function LoadingTripPage() {
  const params = useParams<{ shareId: string }>();
  const shareId = params?.shareId;

  // Synchronous on client first paint so the morph lands on the real photo.
  const [trip, setTrip] = useState<CachedTrip>(() => readCache(shareId));

  // If hydration didn't have the cache (e.g. dev), try once more on mount.
  useEffect(() => {
    if (!trip.heroImage) {
      const fresh = readCache(shareId);
      if (fresh.heroImage) setTrip(fresh);
    }
  }, [shareId, trip.heroImage]);

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
        {/* Hero photo — same viewTransitionName as the dashboard card and
            the destination TripPreview hero, so the morph lands here. */}
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

        {/* Hero overlay matching production */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'linear-gradient(to top, rgba(26,20,16,0.62) 0%, rgba(26,20,16,0.32) 35%, rgba(26,20,16,0.10) 65%, transparent 100%)',
          }}
        />

        {/* Hero text + paper card placeholder, anchored bottom */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            padding: '0 24px calc(40px + env(safe-area-inset-bottom))',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {trip.name ? (
            <h1
              style={{
                fontFamily: '"Fraunces", "Iowan Old Style", "Palatino", Georgia, serif',
                fontOpticalSizing: 'auto',
                fontSize: 46,
                fontWeight: 380,
                lineHeight: 1.0,
                letterSpacing: '-0.022em',
                color: '#C14F2A',
                textShadow: '0 1px 2px rgba(0,0,0,0.45), 0 8px 28px rgba(0,0,0,0.4)',
                margin: 0,
              }}
            >
              {trip.name}
            </h1>
          ) : (
            <div
              style={{
                width: '64%',
                height: 44,
                borderRadius: 6,
                background: 'rgba(251,247,241,0.14)',
              }}
            />
          )}

          <div
            style={{
              marginTop: 18,
              padding: '20px 22px 22px',
              display: 'flex',
              flexDirection: 'column',
              background: 'rgba(251, 247, 241, 0.72)',
              backdropFilter: 'blur(24px) saturate(160%)',
              WebkitBackdropFilter: 'blur(24px) saturate(160%)',
              border: '1px solid rgba(232, 225, 214, 0.55)',
              borderRadius: 12,
              boxShadow: 'rgba(26, 20, 16, 0.22) 0 18px 44px -12px',
            }}
          >
            {trip.subtitle ? (
              <div
                style={{
                  fontFamily: '"Fraunces", "Iowan Old Style", "Palatino", Georgia, serif',
                  fontOpticalSizing: 'auto',
                  fontStyle: 'italic',
                  fontSize: 19,
                  fontWeight: 380,
                  lineHeight: 1.4,
                  color: '#1A1410',
                }}
              >
                {trip.subtitle}
              </div>
            ) : (
              <div style={{ width: '85%', height: 22, borderRadius: 4, background: '#E8E1D6' }} />
            )}

            <div
              style={{
                width: 36,
                height: 1,
                background: '#E8E1D6',
                margin: '14px 0 16px',
              }}
            />

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div style={{ width: '100%', height: 14, borderRadius: 4, background: '#E8E1D6', opacity: 0.8 }} />
              <div style={{ width: '92%', height: 14, borderRadius: 4, background: '#E8E1D6', opacity: 0.8 }} />
              <div style={{ width: '60%', height: 14, borderRadius: 4, background: '#E8E1D6', opacity: 0.8 }} />
            </div>

            {(trip.start || trip.end) && (
              <div
                style={{
                  display: 'flex',
                  gap: 32,
                  marginTop: 20,
                  paddingTop: 18,
                  borderTop: '1px solid #E8E1D6',
                }}
              >
                {trip.start && (
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span
                      style={{
                        fontFamily: '"Inter", system-ui, sans-serif',
                        fontVariantNumeric: 'tabular-nums',
                        fontSize: 22,
                        fontWeight: 600,
                        color: '#1A1410',
                        letterSpacing: '-0.012em',
                      }}
                    >
                      {formatDate(trip.start)}
                    </span>
                    <span
                      style={{
                        fontFamily: '"Inter", system-ui, sans-serif',
                        fontSize: 10,
                        fontWeight: 600,
                        letterSpacing: '0.18em',
                        textTransform: 'uppercase',
                        color: '#6B6157',
                        marginTop: 4,
                      }}
                    >
                      Start
                    </span>
                  </div>
                )}
                {trip.end && (
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span
                      style={{
                        fontFamily: '"Inter", system-ui, sans-serif',
                        fontVariantNumeric: 'tabular-nums',
                        fontSize: 22,
                        fontWeight: 600,
                        color: '#1A1410',
                        letterSpacing: '-0.012em',
                      }}
                    >
                      {formatDate(trip.end)}
                    </span>
                    <span
                      style={{
                        fontFamily: '"Inter", system-ui, sans-serif',
                        fontSize: 10,
                        fontWeight: 600,
                        letterSpacing: '0.18em',
                        textTransform: 'uppercase',
                        color: '#6B6157',
                        marginTop: 4,
                      }}
                    >
                      End
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
