import { randomUUID } from 'node:crypto';
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
const MAX_READY_TEXT_BYTES = 1_000_000;
const SOURCE_SELECT = 'id, file_name, content_type, storage_path, extracted_text, status, error, created_at, updated_at';

const TEXT_TYPES = new Set([
  'application/json',
  'text/markdown',
  'text/plain',
]);

type AdminClient = ReturnType<typeof createAdminClient>;

type SourceRow = TravelProfileSourceReference & {
  storage_path?: string | null;
  error?: string | null;
  updated_at?: string | null;
};

function fileContentType(file: File): string {
  const lowerName = file.name.toLowerCase();
  if (file.type) return file.type;
  if (lowerName.endsWith('.md') || lowerName.endsWith('.markdown')) return 'text/markdown';
  if (lowerName.endsWith('.json')) return 'application/json';
  return 'text/plain';
}

function canExtractText(contentType: string, fileName: string): boolean {
  const lowerName = fileName.toLowerCase();
  return (
    TEXT_TYPES.has(contentType) ||
    lowerName.endsWith('.txt') ||
    lowerName.endsWith('.md') ||
    lowerName.endsWith('.markdown') ||
    lowerName.endsWith('.json')
  );
}

function safeFileName(value: string): string {
  const cleaned = value
    .replace(/[^a-zA-Z0-9._-]+/gu, '-')
    .replace(/-{2,}/gu, '-')
    .replace(/^-|-$/gu, '')
    .slice(0, 120);
  return cleaned || 'previous-trip.txt';
}

function normalizeUploadedText(contentType: string, text: string): string {
  if (contentType === 'application/json') {
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  }
  return text;
}

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

async function loadProfileAndSources(admin: AdminClient, userId: string) {
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

  return {
    profile,
    sources: (sources ?? []) as SourceRow[],
  };
}

async function rebuildReference(admin: AdminClient, userId: string) {
  const { profile, sources } = await loadProfileAndSources(admin, userId);
  const preferences = normalizeTravelProfilePreferences(profile?.preferences);
  const referenceMarkdown = buildTravelReferenceMarkdown(preferences, sources);
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
    sources: sources.map(sourceForClient),
  };
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('travel_profile_sources')
    .select(SOURCE_SELECT)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ sources: ((data ?? []) as SourceRow[]).map(sourceForClient) });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const form = await request.formData().catch(() => null);
  const uploaded = form?.get('file');
  if (!(uploaded instanceof File)) {
    return NextResponse.json({ error: 'Upload a previous trip file.' }, { status: 400 });
  }

  const contentType = fileContentType(uploaded);
  const cleanName = safeFileName(uploaded.name);
  const storagePath = `${user.id}/${randomUUID()}-${cleanName}`;
  const shouldExtract = canExtractText(contentType, uploaded.name);

  if (shouldExtract && uploaded.size > MAX_READY_TEXT_BYTES) {
    return NextResponse.json(
      { error: 'Text imports must be 1 MB or smaller for immediate reference extraction.' },
      { status: 413 }
    );
  }

  let extractedText: string | null = null;
  let status: 'pending' | 'ready' = 'pending';
  let extractionError: string | null = 'Text extraction is pending for this file type.';

  if (shouldExtract) {
    extractedText = normalizeUploadedText(contentType, await uploaded.text()).slice(0, 60_000);
    status = 'ready';
    extractionError = null;
  }

  const admin = createAdminClient();
  const upload = await admin.storage
    .from(BUCKET)
    .upload(storagePath, uploaded, {
      contentType,
      upsert: false,
    });

  if (upload.error) {
    return NextResponse.json({ error: upload.error.message }, { status: 500 });
  }

  const { data: source, error } = await admin
    .from('travel_profile_sources')
    .insert({
      user_id: user.id,
      source_kind: 'upload',
      file_name: uploaded.name,
      content_type: contentType,
      storage_path: storagePath,
      extracted_text: extractedText,
      status,
      error: extractionError,
    })
    .select(SOURCE_SELECT)
    .single();

  if (error || !source) {
    await admin.storage.from(BUCKET).remove([storagePath]);
    return NextResponse.json(
      { error: error?.message ?? 'Failed to save travel profile source' },
      { status: 500 }
    );
  }

  try {
    const rebuilt = await rebuildReference(admin, user.id);
    return NextResponse.json({
      source: sourceForClient(source as SourceRow),
      profile: rebuilt.profile,
      sources: rebuilt.sources,
    }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to rebuild travel reference' },
      { status: 500 }
    );
  }
}
