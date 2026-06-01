'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { usePathname } from 'next/navigation';

interface CachedItineraryPreview {
  heroImage?: string;
  name?: string;
  subtitle?: string;
}

function readCache(pathname: string | null): CachedItineraryPreview {
  if (!pathname || typeof window === 'undefined') return {};
  try {
    const raw = sessionStorage.getItem(`vt-itinerary:${pathname}`);
    if (!raw) return {};
    return JSON.parse(raw) as CachedItineraryPreview;
  } catch {
    return {};
  }
}

export default function LoadingPublicItineraryPage() {
  const pathname = usePathname();
  const [preview, setPreview] = useState<CachedItineraryPreview>(() => readCache(pathname));
  const [showLabel, setShowLabel] = useState(false);

  useEffect(() => {
    if (!preview.heroImage) {
      const fresh = readCache(pathname);
      if (fresh.heroImage) setPreview(fresh);
    }
  }, [pathname, preview.heroImage]);

  useEffect(() => {
    const timer = setTimeout(() => setShowLabel(true), 500);
    return () => clearTimeout(timer);
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
        {preview.heroImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview.heroImage}
            alt=""
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              viewTransitionName: 'trip-hero',
            } as CSSProperties}
          />
        ) : (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: '#1A1410',
              viewTransitionName: 'trip-hero',
            } as CSSProperties}
          />
        )}

        <div
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'linear-gradient(to top, rgba(26,20,16,0.62) 0%, rgba(26,20,16,0.28) 42%, rgba(26,20,16,0.08) 72%, transparent 100%)',
          }}
        />

        {(preview.name || showLabel) && (
          <div
            style={{
              position: 'absolute',
              left: 24,
              right: 24,
              bottom: 'calc(48px + env(safe-area-inset-bottom))',
              color: '#FBF7F1',
              animation: 'loading-fade-in 220ms ease-out both',
            }}
          >
            {preview.name ? (
              <>
                <div
                  style={{
                    fontFamily: '"Fraunces", "Iowan Old Style", "Palatino", Georgia, serif',
                    fontSize: 38,
                    fontWeight: 380,
                    lineHeight: 1,
                    letterSpacing: 0,
                    color: '#C14F2A',
                    textShadow: '0 1px 2px rgba(0,0,0,0.45), 0 8px 28px rgba(0,0,0,0.4)',
                  }}
                >
                  {preview.name}
                </div>
                {preview.subtitle ? (
                  <div
                    style={{
                      marginTop: 8,
                      fontFamily: '"Fraunces", "Iowan Old Style", "Palatino", Georgia, serif',
                      fontStyle: 'italic',
                      fontSize: 17,
                      fontWeight: 360,
                      lineHeight: 1.4,
                      textShadow: '0 1px 2px rgba(0,0,0,0.4)',
                    }}
                  >
                    {preview.subtitle}
                  </div>
                ) : null}
              </>
            ) : (
              <div
                style={{
                  textAlign: 'center',
                  fontFamily: '"Fraunces", "Iowan Old Style", "Palatino", Georgia, serif',
                  fontStyle: 'italic',
                  fontSize: 14,
                  fontWeight: 360,
                  color: 'rgba(251, 247, 241, 0.78)',
                }}
              >
                Loading...
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
