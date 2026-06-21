import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  buildTravelReferenceMarkdown,
  normalizeTravelProfilePreferences,
  TravelProfilePreferencesSchema,
  type TravelProfileSourceReference,
} from '@/lib/travel-profile';

export const dynamic = 'force-dynamic';

const SOURCE_SELECT = 'id, file_name, content_type, extracted_text, status, created_at';

const PutBodySchema = z.object({
  preferences: TravelProfilePreferencesSchema,
  complete: z.boolean().optional().default(true),
});

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('travel_profiles')
    .select('user_id, preferences, reference_markdown, reference_generated_at, onboarding_completed_at, created_at, updated_at')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ profile: null, complete: false });
  }

  return NextResponse.json({
    profile: {
      ...data,
      preferences: normalizeTravelProfilePreferences(data.preferences),
    },
    complete: Boolean(data.onboarding_completed_at),
  });
}

export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  let body: z.infer<typeof PutBodySchema>;
  try {
    body = PutBodySchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      { error: 'Invalid travel profile', detail: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }

  const now = new Date().toISOString();
  const preferences = body.preferences;

  const admin = createAdminClient();
  const { data: sources, error: sourcesError } = await admin
    .from('travel_profile_sources')
    .select(SOURCE_SELECT)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (sourcesError) {
    return NextResponse.json({ error: sourcesError.message }, { status: 500 });
  }

  const referenceMarkdown = buildTravelReferenceMarkdown(
    preferences,
    (sources ?? []) as TravelProfileSourceReference[]
  );

  const { data, error } = await admin
    .from('travel_profiles')
    .upsert({
      user_id: user.id,
      preferences,
      reference_markdown: referenceMarkdown,
      reference_generated_at: now,
      onboarding_completed_at: body.complete ? now : null,
      updated_at: now,
    })
    .select('user_id, preferences, reference_markdown, reference_generated_at, onboarding_completed_at, created_at, updated_at')
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? 'Failed to save travel profile' },
      { status: 500 }
    );
  }

  return NextResponse.json({
    profile: {
      ...data,
      preferences: normalizeTravelProfilePreferences(data.preferences),
    },
    complete: Boolean(data.onboarding_completed_at),
  });
}
