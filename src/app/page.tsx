/* eslint-disable @next/next/no-img-element */

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowRight,
  BedDouble,
  CalendarDays,
  CheckCircle2,
  FileText,
  MapPinned,
  MessageCircle,
  Plane,
  Sparkles,
  UploadCloud,
  Utensils,
  WifiOff,
} from 'lucide-react';
import AppTopBar from '@/components/ui/AppTopBar';
import { publicItineraries } from '@/lib/public-itineraries';
import '@/styles/landing.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'OurTrips - Turn Travel Chaos Into a Portable Trip Guide',
  description:
    'Collect bookings, notes, ideas, and preferences in OurTrips. The built-in travel agent shapes them into a beautiful day-by-day itinerary you can share, map, edit, and save offline.',
  alternates: {
    canonical: 'https://ourtrips.to',
  },
  openGraph: {
    title: 'OurTrips - Turn Travel Chaos Into a Portable Trip Guide',
    description:
      'Collect the messy pile of travel planning and turn it into a beautiful day-by-day itinerary you can take with you.',
    url: 'https://ourtrips.to',
    siteName: 'OurTrips',
    locale: 'en_US',
    type: 'website',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'OurTrips - your trips, beautifully presented',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'OurTrips - Turn Travel Chaos Into a Portable Trip Guide',
    description:
      'Collect bookings, notes, ideas, and preferences in OurTrips. Turn them into a day-by-day guide for the road.',
    images: ['/og-image.png'],
  },
};

const planningInputs = [
  { icon: Plane, label: 'Flights and trains', text: 'Arrival times, route ideas, rental cars, ferries, and transfers.' },
  { icon: BedDouble, label: 'Hotels and stays', text: 'Booked rooms, open hotel decisions, check-in notes, and stay preferences.' },
  { icon: Utensils, label: 'Food and plans', text: 'Restaurant links, must-do meals, tickets, walks, museums, and detours.' },
  { icon: FileText, label: 'Loose material', text: 'PDFs, old plans, pasted notes, family requests, and the things you do not want to forget.' },
];

const carryFeatures = [
  { icon: CalendarDays, title: 'Day-by-day guide', text: 'Each day has its own plan, stay, meals, transport, map, and practical tips.' },
  { icon: MapPinned, title: 'Maps that match the plan', text: 'Route points and day maps keep places close when the trip stops being theoretical.' },
  { icon: CheckCircle2, title: 'Open decisions stay visible', text: 'Booking statuses, hotel proposals, and action items keep the plan honest.' },
  { icon: WifiOff, title: 'Made for the road', text: 'Save trips offline and open the day you need without digging through old messages.' },
];

const agentMoments = [
  'Build the first complete draft from your brief.',
  'Make tomorrow lighter without rewriting the whole trip.',
  'Find dinner near the hotel and save the reservation note.',
  'Mark a stay booked and review surrounding days for stale plans.',
];

function ProductGuideMockup() {
  return (
    <div className="landing-guide-mockup" aria-label="OurTrips trip guide preview">
      <div className="landing-guide-top">
        <span>Today</span>
        <strong>Day 3 · Kyoto</strong>
      </div>
      <div className="landing-guide-map">
        <span className="landing-map-pin landing-map-pin-a" />
        <span className="landing-map-pin landing-map-pin-b" />
        <span className="landing-map-pin landing-map-pin-c" />
        <span className="landing-map-route" />
      </div>
      <div className="landing-guide-section">
        <div>
          <span className="landing-guide-kicker">Morning</span>
          <strong>Philosopher&apos;s Path before the crowds</strong>
          <p>Quiet temples, coffee nearby, and a slower start after yesterday&apos;s long transfer.</p>
        </div>
      </div>
      <div className="landing-guide-grid">
        <div>
          <span><BedDouble size={15} aria-hidden="true" /> Stay</span>
          <strong>Ryokan booked</strong>
        </div>
        <div>
          <span><Utensils size={15} aria-hidden="true" /> Dinner</span>
          <strong>Reserve today</strong>
        </div>
      </div>
      <div className="landing-guide-chat">
        <MessageCircle size={16} aria-hidden="true" />
        <span>Ask: make Day 4 less packed</span>
      </div>
    </div>
  );
}

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
      // redirect() throws to signal navigation; re-throw so Next.js handles it.
      if (err && typeof err === 'object' && 'digest' in err && typeof (err as { digest: unknown }).digest === 'string' && (err as { digest: string }).digest.startsWith('NEXT_REDIRECT')) {
        throw err;
      }
      // Supabase unavailable; show landing page.
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
      <AppTopBar
        suffix="Trip guide"
        actions={
          <div className="landing-nav-links">
            <Link href="/itineraries" className="landing-nav-link">Examples</Link>
            <Link href="/pricing" className="landing-nav-link">Pricing</Link>
            <Link href="/blog" className="landing-nav-link">Journal</Link>
            <Link href="/changelog" className="landing-nav-link">Changelog</Link>
            <Link href="/login" className="landing-btn-outline">Log in</Link>
          </div>
        }
      />

      <section className="landing-hero">
        <div className="landing-hero-inner">
          <div className="landing-hero-text">
            <div className="landing-hero-badge">Collect · Plan · Carry</div>
            <h1 className="landing-hero-title">
              Turn travel chaos into a trip you can actually take with you.
            </h1>
            <p className="landing-hero-subtitle">
              Gather your bookings, ideas, notes, preferences, and half-formed plans.
              OurTrips helps shape them into a beautiful day-by-day guide, then keeps
              everything close when you are on the road.
            </p>
            <div className="landing-hero-actions">
              <Link href="/login?next=/dashboard%3Fagent%3Dnew" className="landing-btn-primary">Start a trip</Link>
              <Link href="/itineraries" className="landing-btn-secondary">See an example</Link>
            </div>
          </div>

          <figure className="landing-hero-figure landing-hero-product">
            <div className="landing-paper-stack">
              <div className="landing-loose-note landing-loose-note-a">
                <UploadCloud size={15} aria-hidden="true" />
                <span>Hotel PDF</span>
              </div>
              <div className="landing-loose-note landing-loose-note-b">
                <MapPinned size={15} aria-hidden="true" />
                <span>Food list</span>
              </div>
              <ProductGuideMockup />
            </div>
            <figcaption className="landing-hero-caption">
              <span className="place">A travel-ready guide</span>
              <span className="meta">built from the messy pile</span>
            </figcaption>
          </figure>
        </div>
      </section>

      <section className="landing-pillars">
        <div className="landing-section-header">
          <div>
            <div className="landing-section-eyebrow">The real problem</div>
            <h2 className="landing-section-title">Travel planning starts messy. The trip should not stay that way.</h2>
          </div>
          <p className="landing-section-copy">
            OurTrips is a home for the weeks before you leave and the day you are actually there:
            collecting the details, shaping the route, and carrying the guide in your pocket.
          </p>
        </div>

        <div className="landing-pillar-grid">
          <article className="landing-pillar">
            <span className="landing-pillar-num">1</span>
            <h3>Collect everything</h3>
            <p>Bring together bookings, ideas, uploaded references, traveler profiles, and loose notes before they scatter across apps and chats.</p>
          </article>
          <article className="landing-pillar">
            <span className="landing-pillar-num">2</span>
            <h3>Shape the trip</h3>
            <p>The built-in travel agent turns your material into a day-by-day plan with route logic, pacing, maps, meals, stays, and open decisions.</p>
          </article>
          <article className="landing-pillar">
            <span className="landing-pillar-num">3</span>
            <h3>Carry it with you</h3>
            <p>On the road, open the day you need: where to go, where you sleep, what is booked, what is still open, and what works offline.</p>
          </article>
        </div>
      </section>

      <section className="landing-collect">
        <div className="landing-collect-inner">
          <div>
            <div className="landing-section-eyebrow">Information collection</div>
            <h2 className="landing-section-title">Bring the whole trip pile.</h2>
            <p className="landing-section-copy">
              Travel information rarely arrives neatly. OurTrips gives every useful detail a place
              to land, so the agent can plan from what is real instead of starting from a blank prompt.
            </p>
          </div>
          <div className="landing-input-grid">
            {planningInputs.map((item) => {
              const Icon = item.icon;
              return (
                <article className="landing-input-card" key={item.label}>
                  <span className="landing-input-icon"><Icon size={18} aria-hidden="true" /></span>
                  <h3>{item.label}</h3>
                  <p>{item.text}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="landing-steps">
        <div className="landing-steps-header">
          <div>
            <div className="landing-steps-eyebrow">Trip planning</div>
            <h2 className="landing-steps-heading">
              The planning part should feel like the trip has already begun.
            </h2>
          </div>
          <p className="landing-steps-subheading">
            Start inside OurTrips. Answer a few travel-agent questions, add your context,
            and watch a first draft become something you can share and refine.
          </p>
        </div>

        <div className="landing-steps-inner">
          <div className="landing-step">
            <span className="landing-step-num">1</span>
            <h3 className="landing-step-title">Tell the basics</h3>
            <p className="landing-step-desc">
              Destination, dates, travelers, origin, pace, budget, must-dos, and what is already booked.
            </p>
          </div>
          <div className="landing-step">
            <span className="landing-step-num">2</span>
            <h3 className="landing-step-title">Add the messy context</h3>
            <p className="landing-step-desc">
              Paste notes or upload references so the agent can preserve real constraints and preferences.
            </p>
          </div>
          <div className="landing-step">
            <span className="landing-step-num">3</span>
            <h3 className="landing-step-title">Open the guide</h3>
            <p className="landing-step-desc">
              OurTrips builds the itinerary, checks quality and logistics, and opens the finished first draft.
            </p>
          </div>
        </div>
      </section>

      <section className="landing-agent">
        <div className="landing-agent-card">
          <div>
            <div className="landing-section-eyebrow">The agent stays with the trip</div>
            <h2 className="landing-section-title">Keep improving the real itinerary.</h2>
            <p className="landing-section-copy">
              The chat is not a separate planning thread. It can read the trip, edit the right day,
              update one restaurant or hotel, create booking links, and keep maps and logistics aligned.
            </p>
          </div>
          <div className="landing-agent-list">
            {agentMoments.map((moment) => (
              <div className="landing-agent-item" key={moment}>
                <Sparkles size={16} aria-hidden="true" />
                <span>{moment}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-carry">
        <div className="landing-section-header">
          <div>
            <div className="landing-section-eyebrow">On-the-go access</div>
            <h2 className="landing-section-title">When you travel, the day is the interface.</h2>
          </div>
          <p className="landing-section-copy">
            The finished trip is not a document you have to decode. It is a guide organized around
            the thing travelers need most: what matters today.
          </p>
        </div>
        <div className="landing-carry-grid">
          {carryFeatures.map((feature) => {
            const Icon = feature.icon;
            return (
              <article className="landing-carry-card" key={feature.title}>
                <Icon size={20} aria-hidden="true" />
                <h3>{feature.title}</h3>
                <p>{feature.text}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="landing-itineraries">
        <div className="landing-itineraries-header">
          <div>
            <div className="landing-itineraries-eyebrow">Example guides</div>
            <h2 className="landing-itineraries-heading">
              See what a trip looks like after the planning mess has been shaped.
            </h2>
          </div>
          <div className="landing-itineraries-copy">
            <p>
              Sample trips across reefs, food cities, family nature loops,
              romantic coastlines, safaris, and expedition travel.
            </p>
            <Link href="/itineraries" className="landing-tell-more">
              Browse all examples
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
                  Open guide
                  <ArrowRight size={14} strokeWidth={1.7} aria-hidden="true" />
                </Link>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-connector">
        <div className="landing-connector-inner">
          <div>
            <div className="landing-section-eyebrow">Already planning elsewhere?</div>
            <h2>External agents still work.</h2>
            <p>
              If you already use Claude, Codex, or another agent with remote MCP support,
              you can still connect OurTrips and send an outside planning conversation into
              the same portable guide.
            </p>
          </div>
          <Link href="/guide" className="landing-tell-more">
            Read the connector guide
            <ArrowRight size={14} strokeWidth={1.6} aria-hidden="true" />
          </Link>
        </div>
      </section>

      <section className="landing-cta">
        <div className="landing-cta-inner">
          <span className="landing-cta-eyebrow">Begin</span>
          <h2 className="landing-cta-title">
            Put the whole trip in one place.
          </h2>
          <p className="landing-cta-desc">
            Free to use. Start with a few answers, then let the guide take shape.
          </p>
          <Link href="/login?next=/dashboard%3Fagent%3Dnew" className="landing-btn-primary">Start a trip</Link>
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
