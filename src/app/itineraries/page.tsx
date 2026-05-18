import type { Metadata } from 'next';
import Link from 'next/link';
import ItinerariesExplorer from '@/components/itineraries/ItinerariesExplorer';
import LogoSuffix from '@/components/ui/LogoSuffix';
import { publicItineraries } from '@/lib/public-itineraries';
import '@/styles/itineraries.css';

export const metadata: Metadata = {
  title: 'Itineraries — OurTrips',
  description:
    'Browse public OurTrips itineraries for family travel, food trips, adventure routes, romantic escapes, and once-in-a-lifetime journeys.',
  alternates: {
    canonical: 'https://ourtrips.to/itineraries',
  },
  openGraph: {
    title: 'Itineraries — OurTrips',
    description:
      'Public, remixable travel itineraries for family travel, food trips, adventure routes, romantic escapes, and once-in-a-lifetime journeys.',
    url: 'https://ourtrips.to/itineraries',
    siteName: 'OurTrips',
    locale: 'en_US',
    type: 'website',
  },
};

export default function ItinerariesPage() {
  return (
    <div className="itineraries-page">
      <nav className="itineraries-nav">
        <div className="itineraries-nav-inner">
          <Link href="/" className="itineraries-logo">
            OurTrips<LogoSuffix />
          </Link>
          <div className="itineraries-nav-links">
            <Link href="/travel-skills" className="itineraries-nav-link">Travel Skills</Link>
            <Link href="/blog" className="itineraries-nav-link">Journal</Link>
            <Link href="/login" className="itineraries-btn-outline">Log in</Link>
          </div>
        </div>
      </nav>

      <main>
        <section className="itineraries-hero">
          <div className="itineraries-hero-inner">
            <div className="itineraries-hero-copy">
              <div className="itineraries-kicker">Public inspiration</div>
              <h1>Trips worth remixing.</h1>
              <p>
                A first catalogue of public OurTrips itineraries: quiet reef weeks, food-led
                routes, family nature loops, romantic road trips, and full expedition theatre.
              </p>
            </div>
            <div className="itineraries-hero-stats" aria-label="Catalogue summary">
              <div>
                <strong>{publicItineraries.length}</strong>
                <span>sample trips</span>
              </div>
              <div>
                <strong>1-7</strong>
                <span>destinations</span>
              </div>
              <div>
                <strong>7-15</strong>
                <span>days</span>
              </div>
            </div>
          </div>
        </section>

        <ItinerariesExplorer itineraries={publicItineraries} />
      </main>

      <footer className="itineraries-footer">
        <div className="itineraries-footer-inner">
          <span className="itineraries-footer-logo">OurTrips</span>
          <span className="itineraries-footer-copy">Built by Thijs van Schadewijk</span>
        </div>
      </footer>
    </div>
  );
}
