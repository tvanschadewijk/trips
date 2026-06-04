import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import TripPreview from '@/components/preview/TripPreview';
import {
  getPublicItineraryByPath,
  publicItineraries,
  type PublicItinerary,
} from '@/lib/public-itineraries';
import { createClient } from '@/lib/supabase/server';
import { normalizeTripData } from '@/lib/trip-data-normalize';
import type { TripData } from '@/lib/types';

interface Props {
  params: Promise<{ destination: string; slug: string }>;
}

export const dynamic = 'force-dynamic';

type PublicTripRecord = {
  tripData: TripData;
  shareMode: 'companion' | 'remix';
};

export function generateStaticParams() {
  return publicItineraries.map((itinerary) => ({
    destination: itinerary.destinationSlug,
    slug: itinerary.seoSlug,
  }));
}

const loadPublicTrip = cache(async (shareId: string): Promise<PublicTripRecord | null> => {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('trips')
      .select('data, share_mode')
      .eq('share_id', shareId)
      .in('share_mode', ['companion', 'remix'])
      .single();

    if (error || !data) return null;

    return {
      tripData: normalizeTripData(data.data),
      shareMode: (data.share_mode as 'companion' | 'remix') ?? 'companion',
    };
  } catch {
    return null;
  }
});

function buildDescription(itinerary: PublicItinerary, tripData?: TripData): string {
  return tripData?.trip?.summary || itinerary.seoDescription;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { destination, slug } = await params;
  const itinerary = getPublicItineraryByPath(destination, slug);

  if (!itinerary) {
    return {
      title: 'Itinerary not found — OurTrips',
      robots: { index: false, follow: false },
    };
  }

  const record = await loadPublicTrip(itinerary.shareId);
  const description = buildDescription(itinerary, record?.tripData);
  const imageUrl = `/t/${itinerary.shareId}/opengraph-image`;

  return {
    title: itinerary.seoTitle,
    description,
    alternates: {
      canonical: itinerary.url,
    },
    openGraph: {
      title: itinerary.seoTitle,
      description,
      url: itinerary.url,
      siteName: 'OurTrips',
      locale: 'en_US',
      type: 'article',
      images: [
        {
          url: imageUrl,
          width: 1200,
          height: 630,
          alt: itinerary.name,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: itinerary.seoTitle,
      description,
      images: [imageUrl],
    },
  };
}

function itineraryJsonLd(itinerary: PublicItinerary, record: PublicTripRecord): Record<string, unknown>[] {
  const trip = record.tripData.trip;
  const dayItems = record.tripData.days.map((day, index) => ({
    '@type': 'ListItem',
    position: index + 1,
    name: day.title,
    description: day.description || day.subtitle || undefined,
  }));

  return [
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
        {
          '@type': 'ListItem',
          position: 3,
          name: itinerary.name,
          item: itinerary.url,
        },
      ],
    },
    {
      '@context': 'https://schema.org',
      '@type': 'TouristTrip',
      name: trip.name,
      description: trip.summary || itinerary.summary,
      image: trip.hero_image || itinerary.image,
      url: itinerary.url,
      itinerary: {
        '@type': 'ItemList',
        itemListElement: dayItems,
      },
      provider: {
        '@type': 'Organization',
        name: 'OurTrips',
        url: 'https://ourtrips.to',
      },
    },
  ];
}

export default async function PublicItineraryPage({ params }: Props) {
  const { destination, slug } = await params;
  const itinerary = getPublicItineraryByPath(destination, slug);
  if (!itinerary) notFound();

  const record = await loadPublicTrip(itinerary.shareId);
  if (!record) notFound();

  let homeHref = '/';
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) homeHref = '/dashboard';
  } catch {
    homeHref = '/';
  }

  return (
    <>
      <TripPreview
        trips={[record.tripData]}
        autoOpen
        shareId={itinerary.shareId}
        canAddToTrips
        shareMode={record.shareMode}
        homeHref={homeHref}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(itineraryJsonLd(itinerary, record)),
        }}
      />
    </>
  );
}
