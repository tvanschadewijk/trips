'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import LogoSuffix from '@/components/ui/LogoSuffix';
import { publicItineraries } from '@/lib/public-itineraries';
import { createClient, isSupabaseConfigured } from '@/lib/supabase/client';
import '@/styles/login.css';

const tableItineraries = publicItineraries
  .filter((itinerary) =>
    ['Japan', 'Costa Rica', 'Amalfi and Puglia', 'Namibia'].includes(itinerary.destination)
  )
  .map((itinerary, index) => ({ ...itinerary, tableSlot: index + 1 }));

export default function LoginPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  // If user already has a session (e.g. just returned from OAuth callback),
  // redirect to dashboard instead of showing the login page again.
  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setReady(true);
      return;
    }

    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        const params = new URLSearchParams(window.location.search);
        router.replace(params.get('next') || '/dashboard');
      } else {
        setReady(true);
      }
    });
  }, [router]);

  async function handleGoogle() {
    if (!isSupabaseConfigured()) return;

    const supabase = createClient();
    const params = new URLSearchParams(window.location.search);
    const next = params.get('next') || '/dashboard';
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/api/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
  }

  if (!ready) return null;

  return (
    <div className="login">
      <nav className="login-nav">
        <Link href="/" className="login-logo">OurTrips<LogoSuffix /></Link>
      </nav>

      <main className="login-table" aria-label="OurTrips sign in">
        <div className="login-itinerary-cards" aria-hidden="true">
          {tableItineraries.map((itinerary) => (
            <div
              className={`login-itinerary-card login-itinerary-card-${itinerary.tableSlot}`}
              key={itinerary.name}
            >
              <span className="login-itinerary-photo-wrap">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={itinerary.image}
                  alt=""
                  className="login-itinerary-photo"
                  loading="lazy"
                />
              </span>
              <span className="login-itinerary-body">
                <span className="login-itinerary-kicker">
                  {itinerary.days} days · {itinerary.destination}
                </span>
                <span className="login-itinerary-name">{itinerary.name}</span>
                <span className="login-itinerary-meta">
                  {itinerary.tags.slice(0, 3).join(' · ')}
                </span>
              </span>
            </div>
          ))}
        </div>

        <div className="login-card">
          <p className="login-eyebrow">Your trips, beautifully presented</p>
          <h2 className="login-title">Sign in to OurTrips</h2>
          <p className="login-desc">
            {isSupabaseConfigured()
              ? 'Sign in to manage and share your trips.'
              : 'Supabase is not configured for this local preview yet.'}
          </p>

          {!isSupabaseConfigured() && (
            <div className="login-config-warning">
              Add <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to <code>.env.local</code> to enable Google sign-in.
            </div>
          )}

          <button type="button" className="login-btn-google" onClick={handleGoogle} disabled={!isSupabaseConfigured()}>
            <svg viewBox="0 0 24 24" width="20" height="20">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Continue with Google
          </button>
        </div>
      </main>
    </div>
  );
}
