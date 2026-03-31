import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

// GET /api/auth/device/poll?code=XXXX — Poll for device authorization completion
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')?.toUpperCase();
  if (!code) {
    return NextResponse.json({ error: 'Missing code parameter' }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Look up the device code — must not be expired
  const { data, error } = await supabase
    .from('device_codes')
    .select('id, status, api_key_plain')
    .eq('device_code', code)
    .gt('expires_at', new Date().toISOString())
    .single();

  if (error || !data) {
    return NextResponse.json({ error: 'expired_or_invalid' }, { status: 404 });
  }

  if (data.status === 'pending') {
    return NextResponse.json({ status: 'pending' });
  }

  if (data.status === 'completed' && data.api_key_plain) {
    const apiKey = data.api_key_plain;

    // Clear the plaintext key and mark as claimed (one-time retrieval)
    await supabase
      .from('device_codes')
      .update({ api_key_plain: null, status: 'claimed' })
      .eq('id', data.id)
      .eq('status', 'completed');

    return NextResponse.json({ status: 'complete', api_key: apiKey });
  }

  // Already claimed or unknown state
  return NextResponse.json({ error: 'expired_or_invalid' }, { status: 404 });
}
