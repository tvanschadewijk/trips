import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import LogoSuffix from '@/components/ui/LogoSuffix';
import NewTripCreator from '@/components/trips/NewTripCreator';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import {
  normalizeTravelProfilePreferences,
  profileIsComplete,
  type TravelProfileRecord,
} from '@/lib/travel-profile';
import '@/styles/trip-create.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Create Trip — OurTrips',
  description: 'Create a new OurTrips itinerary from inside OurTrips.',
  robots: { index: false, follow: false },
};

async function loadTravelProfile(userId: string): Promise<TravelProfileRecord | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('travel_profiles')
    .select('user_id, preferences, reference_markdown, reference_generated_at, onboarding_completed_at, created_at, updated_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (!data) return null;

  return {
    ...data,
    preferences: normalizeTravelProfilePreferences(data.preferences),
  };
}

export default async function NewTripPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent('/trips/new')}`);
  }

  const profile = await loadTravelProfile(user.id);
  const preferences = normalizeTravelProfilePreferences(profile?.preferences);

  return (
    <main className="trip-create-page">
      <nav className="trip-create-nav">
        <Link href="/dashboard" className="trip-create-logo">
          OurTrips<LogoSuffix />
        </Link>
        <Link href="/dashboard" className="trip-create-nav-link">Trips</Link>
      </nav>

      <header className="trip-create-header">
        <p className="trip-create-eyebrow">New itinerary</p>
        <h1>Ask Travel Agent</h1>
        <p>
          Start with the travel agent. It will collect the brief, create the workspace,
          and keep you updated while the first draft is built.
        </p>
      </header>

      <NewTripCreator
        initialPreferences={preferences}
        profileComplete={profileIsComplete(profile)}
      />
    </main>
  );
}
