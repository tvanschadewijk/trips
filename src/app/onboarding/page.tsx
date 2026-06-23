import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import AppTopBar from '@/components/ui/AppTopBar';
import TravelProfileForm from '@/components/travel-profile/TravelProfileForm';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import {
  normalizeTravelProfilePreferences,
  type TravelProfilePreferences,
  type TravelProfileSourceReference,
} from '@/lib/travel-profile';
import '@/styles/travel-profile.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Travel Profile — OurTrips',
  description: 'Create the travel profile OurTrips uses to plan new trips.',
  robots: { index: false, follow: false },
};

type Props = {
  searchParams: Promise<{ next?: string }>;
};

function safeNextHref(value: string | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/dashboard?agent=new';
  return value;
}

async function loadInitialPreferences(userId: string): Promise<TravelProfilePreferences> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('travel_profiles')
    .select('preferences')
    .eq('user_id', userId)
    .maybeSingle();

  return normalizeTravelProfilePreferences(data?.preferences);
}

async function loadInitialSources(userId: string): Promise<TravelProfileSourceReference[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('travel_profile_sources')
    .select('id, file_name, content_type, extracted_text, status, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  return ((data ?? []) as TravelProfileSourceReference[]).map((source) => ({
    ...source,
    extracted_text: source.extracted_text?.slice(0, 12_000) ?? null,
  }));
}

export default async function OnboardingPage({ searchParams }: Props) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent('/onboarding')}`);
  }

  const [initialPreferences, initialSources] = await Promise.all([
    loadInitialPreferences(user.id),
    loadInitialSources(user.id),
  ]);
  const nextHref = safeNextHref(params.next);

  return (
    <main className="profile-page">
      <AppTopBar href="/dashboard" suffix="Travel profile" />

      <header className="profile-header">
        <p className="profile-eyebrow">First-run setup</p>
        <h1>Your travel profile</h1>
        <p>
          OurTrips uses these preferences when it creates a new itinerary.
          You can change them later.
        </p>
      </header>

      <TravelProfileForm
        initialPreferences={initialPreferences}
        initialSources={initialSources}
        nextHref={nextHref}
      />
    </main>
  );
}
