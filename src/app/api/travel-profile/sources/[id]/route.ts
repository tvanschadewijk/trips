import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import {
  buildTravelReferenceMarkdown,
  normalizeTravelProfilePreferences,
  type TravelProfileSourceReference,
} from '@/lib/travel-profile';

export const dynamic = 'force-dynamic';

const BUCKET = 'travel-profile-sources';
const SOURCE_SELECT = 'id, file_name, content_type, storage_path, extracted_text, status, error, created_at, updated_at';

type AdminClient = ReturnType<typeof createAdminClient>;

type SourceRow = TravelProfileSourceReference & {
  storage_path?: string | null;
  error?: string | null;
  updated_at?: string | null;
};

function sourceForClient(source: SourceRow): SourceRow {
  return {
    id: source.id,
    file_name: source.file_name,
    content_type: source.content_type,
    storage_path: source.storage_path,
    extracted_text: source.extracted_text?.slice(0, 12_000) ?? null,
    status: source.status,
    error: source.error ?? null,
    created_at: source.created_at ?? null,
    updated_at: source.updated_at ?? null,
  };
}

async function rebuildReference(admin: AdminClient, userId: string) {
  const [{ data: profile }, { data: sources }] = await Promise.all([
    admin
      .from('travel_profiles')
      .select('user_id, preferences, reference_markdown, reference_generated_at, onboarding_completed_at, created_at, updated_at')
      .eq('user_id', userId)
      .maybeSingle(),
    admin
      .from('travel_profile_sources')
      .select(SOURCE_SELECT)
      .eq('user_id', userId)
      .order('created_at', { ascending: false }),
  ]);

  const preferences = normalizeTravelProfilePreferences(profile?.preferences);
  const referenceMarkdown = buildTravelReferenceMarkdown(preferences, (sources ?? []) as SourceRow[]);
  const now = new Date().toISOString();

  const { data, error } = await admin
    .from('travel_profiles')
    .upsert({
      user_id: userId,
      preferences,
      reference_markdown: referenceMarkdown,
      reference_generated_at: now,
      onboarding_completed_at: profile?.onboarding_completed_at ?? null,
      updated_at: now,
    })
    .select('user_id, preferences, reference_markdown, reference_generated_at, onboarding_completed_at, created_at, updated_at')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to rebuild travel reference');
  }

  return {
    profile: {
      ...data,
      preferences: normalizeTravelProfilePreferences(data.preferences),
    },
    sources: ((sources ?? []) as SourceRow[]).map(sourceForClient),
  };
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: source, error: findError } = await admin
    .from('travel_profile_sources')
    .select(SOURCE_SELECT)
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (findError) {
    return NextResponse.json({ error: findError.message }, { status: 500 });
  }
  if (!source) {
    return NextResponse.json({ error: 'Travel profile source not found' }, { status: 404 });
  }

  const { error: deleteError } = await admin
    .from('travel_profile_sources')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  if ((source as SourceRow).storage_path) {
    await admin.storage.from(BUCKET).remove([(source as SourceRow).storage_path as string]);
  }

  try {
    const rebuilt = await rebuildReference(admin, user.id);
    return NextResponse.json(rebuilt);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to rebuild travel reference' },
      { status: 500 }
    );
  }
}
