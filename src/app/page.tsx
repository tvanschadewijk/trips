/* eslint-disable @next/next/no-img-element */

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import LogoSuffix from '@/components/ui/LogoSuffix';
import { publicItineraries } from '@/lib/public-itineraries';
import '@/styles/landing.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'OurTrips — AI Travel Itineraries, Beautifully Presented',
  description:
    'Create and share beautiful, interactive travel itineraries from AI planning conversations. Plan day-by-day, add places, save offline, and share with anyone.',
  alternates: {
    canonical: 'https://ourtrips.to',
  },
  openGraph: {
    title: 'OurTrips — AI Travel Itineraries, Beautifully Presented',
    description:
      'Create and share beautiful, interactive travel itineraries from AI planning conversations. Plan day-by-day, add places, save offline, and share with anyone.',
    url: 'https://ourtrips.to',
    siteName: 'OurTrips',
    locale: 'en_US',
    type: 'website',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'OurTrips — your trips, beautifully presented',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'OurTrips — AI Travel Itineraries, Beautifully Presented',
    description:
      'Create and share beautiful, interactive travel itineraries from AI planning conversations. Plan day-by-day, add places, save offline, and share with anyone.',
    images: ['/og-image.png'],
  },
};

export default async function Home() {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    try {
      const [{ headers }, { createClient }] = await Promise.all([
        import('next/headers'),
        import('@/lib/supabase/server'),
      ]);
      const hdrs = await headers();
      const referer = hdrs.get('referer');
      const host = hdrs.get('host');
      let fromInternal = false;
      if (referer && host) {
        try {
          const url = new URL(referer);
          fromInternal = url.host === host && url.pathname !== '/';
        } catch {}
      }

      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user && !fromInternal) {
        const today = new Date().toISOString().slice(0, 10);
        const { data: trips } = await supabase
          .from('trips')
          .select('share_id, data')
          .eq('user_id', user.id);
        const active = trips?.find(t => {
          const start = t.data?.trip?.dates?.start;
          const end = t.data?.trip?.dates?.end;
          return start && end && start <= today && today <= end;
        });
        if (active) redirect(`/t/${active.share_id}`);
        redirect('/dashboard');
      }
    } catch (err) {
      // redirect() throws to signal navigation — re-throw so Next.js handles it
      if (err && typeof err === 'object' && 'digest' in err && typeof (err as { digest: unknown }).digest === 'string' && (err as { digest: string }).digest.startsWith('NEXT_REDIRECT')) {
        throw err;
      }
      // Supabase unavailable — show landing page
    }
  }

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'OurTrips',
      url: 'https://ourtrips.to',
      logo: 'https://ourtrips.to/icons/icon-192.png',
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'OurTrips',
      url: 'https://ourtrips.to',
      potentialAction: {
        '@type': 'ViewAction',
        target: 'https://ourtrips.to/itineraries',
        name: 'Browse itineraries',
      },
    },
  ];
  const landingItineraries = publicItineraries
    .filter((itinerary) => itinerary.destination !== 'Bonaire')
    .slice(0, 3);

  return (
    <div className="landing">
      <nav className="landing-nav">
        <div className="landing-nav-inner">
          <Link href="/" className="landing-logo">OurTrips<LogoSuffix /></Link>
          <div className="landing-nav-links">
            <Link href="/itineraries" className="landing-nav-link">Itineraries</Link>
            <Link href="/changelog" className="landing-nav-link">Changelog</Link>
            <Link href="/blog" className="landing-nav-link">Journal</Link>
            <Link href="/login" className="landing-btn-outline">Log in</Link>
          </div>
        </div>
      </nav>

      <section className="landing-hero">
        <div className="landing-hero-inner">
          <div className="landing-hero-text">
            <div className="landing-hero-badge">An Itinerary, Rediscovered</div>
            <h1 className="landing-hero-title">
              Your next trip, <em>beautifully</em> planned.
            </h1>
            <p className="landing-hero-subtitle">
              Built for agentic AI — Claude CoWork, Codex, and agents that connect to remote MCP servers.
              Talk your trip through, then say the word: OurTrips turns the conversation into
              a shareable, day-by-day itinerary — photographs, bookings, addresses, all in
              one place.
            </p>
            <div className="landing-hero-actions">
              <Link href="/login" className="landing-btn-primary">Start a trip</Link>
              <Link href="/itineraries" className="landing-btn-secondary">See an itinerary</Link>
            </div>
          </div>

          <figure className="landing-hero-figure">
            <div className="landing-hero-image-wrap">
              <img
                src="https://images.unsplash.com/photo-1528127269322-539801943592?w=1400&h=1750&fit=crop&crop=center&q=85"
                alt="Limestone karsts rising from the water in Hạ Long Bay"
                className="landing-hero-image"
                loading="eager"
              />
            </div>
            <figcaption className="landing-hero-caption">
              <span className="place">Hạ Long Bay, Vietnam</span>
            </figcaption>
          </figure>
        </div>
      </section>

      <div className="landing-rule"><hr /></div>

      <section className="landing-itineraries">
        <div className="landing-itineraries-header">
          <div>
            <div className="landing-itineraries-eyebrow">Inspiration library</div>
            <h2 className="landing-itineraries-heading">
              Start from a trip that already has a point of view.
            </h2>
          </div>
          <div className="landing-itineraries-copy">
            <p>
              Public sample itineraries across reefs, food cities, family nature loops,
              romantic coastlines, safaris, and expedition travel.
            </p>
            <Link href="/itineraries" className="landing-tell-more">
              Browse all itineraries
              <ArrowRight size={14} strokeWidth={1.6} aria-hidden="true" />
            </Link>
          </div>
        </div>

        <div className="landing-itinerary-grid">
          {landingItineraries.map((itinerary) => (
            <article className="landing-itinerary-card" key={itinerary.name}>
              <Link href={itinerary.canonicalPath} className="landing-itinerary-image-link" aria-label={itinerary.name}>
                <img src={itinerary.image} alt="" className="landing-itinerary-image" loading="lazy" />
              </Link>
              <div className="landing-itinerary-body">
                <div className="landing-itinerary-meta">
                  <span>{itinerary.days} days</span>
                  <span>{itinerary.destinations} destinations</span>
                </div>
                <h3>{itinerary.name}</h3>
                <p>{itinerary.subtitle}</p>
                <Link href={itinerary.canonicalPath} className="landing-itinerary-link">
                  Open itinerary
                  <ArrowRight size={14} strokeWidth={1.7} aria-hidden="true" />
                </Link>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-steps">
        <div className="landing-steps-header">
          <div>
            <div className="landing-steps-eyebrow">How it works</div>
            <h2 className="landing-steps-heading">
              Plans live everywhere. <span className="landing-steps-heading-accent">OurTrips gathers them.</span>
            </h2>
          </div>
          <p className="landing-steps-subheading">
            Three steps between a sprawling chat thread and a pocket-sized trip you can actually share.
          </p>
        </div>

        <div className="landing-steps-inner">
          <div className="landing-step">
            <span className="landing-step-num">1</span>
            <h3 className="landing-step-title">Install the connector</h3>
            <p className="landing-step-desc">
              Add the OurTrips remote MCP server in Claude or Codex, sign in, and your agent gets the OurTrips tools.
            </p>
            <Link href="/guide" className="landing-btn-primary landing-btn-sm" style={{ gap: '8px' }}>
              Connect OurTrips
              <ArrowRight size={14} strokeWidth={1.7} aria-hidden="true" />
            </Link>
          </div>
          <div className="landing-step">
            <span className="landing-step-num">2</span>
            <h3 className="landing-step-title">Plan out loud</h3>
            <p className="landing-step-desc">
              Talk your trip through with Claude. Flights, stays, food, detours — whatever you&apos;d naturally type.
            </p>
          </div>
          <div className="landing-step">
            <span className="landing-step-num">3</span>
            <h3 className="landing-step-title">Send it to OurTrips</h3>
            <p className="landing-step-desc">
              Say the words. Your trip gets a link you can share with everyone travelling with you.
            </p>
          </div>
        </div>

        <div className="landing-tell-more-wrap">
          <Link href="/guide" className="landing-tell-more">
            Read the full guide
            <ArrowRight size={14} strokeWidth={1.6} aria-hidden="true" />
          </Link>
        </div>
      </section>

      <section className="landing-cta">
        <div className="landing-cta-inner">
          <span className="landing-cta-eyebrow">Begin</span>
          <h2 className="landing-cta-title">
            Somewhere new is <em>closer</em> than it looks.
          </h2>
          <p className="landing-cta-desc">Free to use. Set up in under a minute.</p>
          <Link href="/login" className="landing-btn-primary">Create your account</Link>
        </div>
      </section>

      <footer className="landing-footer">
        <div className="landing-footer-inner">
          <span className="landing-footer-logo">OurTrips</span>
          <span className="landing-footer-copy">
            Built by Thijs van Schadewijk · 2026 · <Link href="/changelog">Changelog</Link>
          </span>
        </div>
      </footer>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </div>
  );
}
