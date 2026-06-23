import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { isLocalPreviewWithoutSupabase } from '@/lib/local-preview';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const DASHBOARD_NEW_TRIP_HREF = '/dashboard?agent=new';

export const metadata: Metadata = {
  title: 'Create Trip — OurTrips',
  description: 'Create a new OurTrips itinerary from inside OurTrips.',
  robots: { index: false, follow: false },
};

export default async function NewTripPage() {
  if (isLocalPreviewWithoutSupabase()) {
    redirect(DASHBOARD_NEW_TRIP_HREF);
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(DASHBOARD_NEW_TRIP_HREF)}`);
  }

  redirect(DASHBOARD_NEW_TRIP_HREF);
}
