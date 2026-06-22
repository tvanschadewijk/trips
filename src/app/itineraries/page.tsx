import type { Metadata } from 'next';
import Link from 'next/link';
import ItinerariesExplorer from '@/components/itineraries/ItinerariesExplorer';
import AppTopBar from '@/components/ui/AppTopBar';
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
  twitter: {
    card: 'summary_large_image',
    title: 'Itineraries — OurTrips',
    description:
      'Public, remixable travel itineraries for family travel, food trips, adventure routes, romantic escapes, and once-in-a-lifetime journeys.',
  },
};

export default function ItinerariesPage() {
  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: 'OurTrips Itineraries',
      description:
        'Public, remixable travel itineraries for family travel, food trips, adventure routes, romantic escapes, and once-in-a-lifetime journeys.',
      url: 'https://ourtrips.to/itineraries',
      mainEntity: {
        '@type': 'ItemList',
        itemListElement: publicItineraries.map((itinerary, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          name: itinerary.name,
          url: itinerary.url,
        })),
      },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        {
          '@type': 'ListItem',
          position: 1,
          name: 'Home',
          item: 'https://ourtrips.to',
        },
        {
          '@type': 'ListItem',
          position: 2,
          name: 'Itineraries',
          item: 'https://ourtrips.to/itineraries',
        },
      ],
    },
  ];

  return (
    <div className="itineraries-page">
      <AppTopBar
        suffix="Itineraries"
        actions={
          <div className="itineraries-nav-links">
            <Link href="/blog" className="itineraries-nav-link">Journal</Link>
            <Link href="/login" className="itineraries-btn-outline">Log in</Link>
          </div>
        }
      />

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
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </div>
  );
}
