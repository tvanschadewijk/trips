import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { generateApiKey } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';

// POST /api/keys — Generate a new API key for the logged-in user
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const apiKey = await generateApiKey(user.id);
    return NextResponse.json({
      key: apiKey,
      message: 'Save this key — it will not be shown again.',
    }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to generate key';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET /api/keys — List API keys (metadata only, no hashes)
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: keys, error } = await admin
    .from('api_keys')
    .select('id, name, created_at, last_used_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ keys: keys || [] });
}

// DELETE /api/keys — Delete an API key
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { id } = await request.json();
  if (!id) {
    return NextResponse.json({ error: 'Key ID required' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from('api_keys')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ status: 'deleted' });
}
