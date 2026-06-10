'use client';

/**
 * Route-level loading state that looks like the trip cover it precedes.
 *
 * Used by /t/[shareId]/loading.tsx and the public itinerary loading route.
 * It reuses the REAL cover classes from preview.css (trip-app → hero-slide →
 * hero-frame), so the skeleton tracks the cover's responsive layout instead
 * of drifting into its own design (the old skeleton was a 430px phone column
 * while the cover had long since become a desktop split layout).
 *
 * Deliberately photo-only: the cover's hero-body text staggers in on mount
 * (preview.css .hero-body > * animations), so any text pre-rendered here
 * would blink — visible in the skeleton, swapped to opacity 0, then faded
 * back in. The photo is the continuity that matters; the title arriving via
 * its designed entrance reads as progressive reveal, not jank.
 *
 * Sequence with the dashboard's view transition: clicking a card holds the
 * old view briefly (crossfade resolves when the trip page has painted, or
 * after a timeout); on fast loads the fade lands directly on the real
 * cover and this component is never seen. On slow loads the fade lands
 * here — same photo, same geometry — and the page swap on arrival is
 * near-invisible.
 */
import { useEffect, useState } from 'react';
import '@/styles/preview.css';

interface Props {
  heroImage?: string;
}

export default function TripCoverSkeleton({ heroImage }: Props) {
  const [showLabel, setShowLabel] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setShowLabel(true), 500);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="trip-app">
      <div className="trip-screen" style={{ display: 'flex' }}>
        <div className="nav-bar over-hero">
          <span className="nav-home" aria-hidden="true">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/ourtrips-favicon-48.png" alt="" />
          </span>
        </div>
        <div className="swipe-viewport">
          <div className="swipe-track" style={{ transform: 'translateX(0)' }}>
            <div className="slide">
              <div className="hero-slide">
                <div className="hero-frame">
                  <div className="hero-bg">
                    {heroImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={heroImage} alt="" draggable={false} />
                    ) : null}
                  </div>
                  <div className="hero-overlay" />
                </div>
              </div>
            </div>
          </div>
        </div>
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
              zIndex: 30,
              pointerEvents: 'none',
            }}
          >
            Loading…
          </div>
        )}
      </div>
    </div>
  );
}
