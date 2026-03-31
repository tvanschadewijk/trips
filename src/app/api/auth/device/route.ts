import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

function generateDeviceCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes).map(b => chars[b % chars.length]).join('');
}

// POST /api/auth/device — Create a new device authorization code
export async function POST(request: Request) {
  const supabase = createAdminClient();

  // Clean up expired codes
  await supabase
    .from('device_codes')
    .delete()
    .lt('expires_at', new Date().toISOString());

  const deviceCode = generateDeviceCode();
  const origin = new URL(request.url).origin;

  const { error } = await supabase
    .from('device_codes')
    .insert({ device_code: deviceCode });

  if (error) {
    return NextResponse.json({ error: 'Failed to create device code' }, { status: 500 });
  }

  return NextResponse.json({
    device_code: deviceCode,
    verification_url: `${origin}/connect?code=${deviceCode}`,
    expires_in: 600,
  });
}
