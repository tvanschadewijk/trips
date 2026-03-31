import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { generateApiKey } from '@/lib/auth';

// POST /api/auth/device/authorize — Link a device code to the logged-in user
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { code } = await request.json();
  if (!code) {
    return NextResponse.json({ error: 'Missing code' }, { status: 400 });
  }

  const admin = createAdminClient();

  // Verify the code is pending and not expired
  const { data: deviceCode, error } = await admin
    .from('device_codes')
    .select('id')
    .eq('device_code', code.toUpperCase())
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
    .single();

  if (error || !deviceCode) {
    return NextResponse.json({ error: 'Invalid or expired code' }, { status: 400 });
  }

  // Generate an API key for this user
  const apiKey = await generateApiKey(user.id, 'claude-skill');

  // Link the device code to the user and store the plaintext key for one-time retrieval
  await admin
    .from('device_codes')
    .update({
      user_id: user.id,
      api_key_plain: apiKey,
      status: 'completed',
    })
    .eq('id', deviceCode.id);

  return NextResponse.json({ success: true });
}
