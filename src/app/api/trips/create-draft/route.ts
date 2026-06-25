import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import {
  TripCreationBriefSchema,
  buildStarterTripInput,
  buildTripGenerationAgentMessage,
} from '@/lib/trip-creation';
import { saveTripForUser, TripServiceError } from '@/lib/trip-service';
import {
  normalizeTravelProfilePreferences,
  type TravelProfileRecord,
} from '@/lib/travel-profile';

export const dynamic = 'force-dynamic';

async function uniqueTripName(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  baseName: string
): Promise<string> {
  const { data } = await admin
    .from('trips')
    .select('name')
    .eq('user_id', userId)
    .ilike('name', `${baseName}%`)
    .is('deleted_at', null);

  const existing = new Set((data ?? []).map((row) => String(row.name)));
  if (!existing.has(baseName)) return baseName;

  for (let index = 2; index < 100; index += 1) {
    const candidate = `${baseName} ${index}`;
    if (!existing.has(candidate)) return candidate;
  }

  return `${baseName} ${Date.now()}`;
}

async function loadTravelProfile(
  admin: ReturnType<typeof createAdminClient>,
  userId: string
): Promise<TravelProfileRecord | null> {
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

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const parsed = TripCreationBriefSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid trip brief', detail: parsed.error.message },
      { status: 400 }
    );
  }

  const brief = parsed.data;
  const admin = createAdminClient();
  const profile = await loadTravelProfile(admin, user.id);

  const baseName = `${brief.destination} Trip`;
  const tripName = await uniqueTripName(admin, user.id, baseName);

  try {
    const starterInput = buildStarterTripInput(brief, tripName);
    const result = await saveTripForUser(
      admin,
      user.id,
      starterInput,
      request.nextUrl.origin
    );

    const { data: session, error: sessionError } = await admin
      .from('trip_generation_sessions')
      .insert({
        user_id: user.id,
        trip_id: result.trip_id,
        brief,
        status: 'draft',
      })
      .select('id')
      .single();

    if (sessionError || !session) {
      return NextResponse.json(
        { error: sessionError?.message ?? 'Failed to create generation session' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      generation_session_id: session.id,
      trip_id: result.trip_id,
      share_id: result.share_id,
      url: result.url,
      agent_message: buildTripGenerationAgentMessage(brief, profile),
      profile_complete: Boolean(profile?.onboarding_completed_at),
    }, { status: 201 });
  } catch (err) {
    if (err instanceof TripServiceError) {
      return NextResponse.json(
        { error: err.message, code: err.code, details: err.details },
        { status: err.status }
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create trip draft' },
      { status: 500 }
    );
  }
}
