import { createAdminClient } from '@/lib/supabase/admin';
import {
  authenticateTokenClient,
  oauthJson,
  oauthOptions,
  OAuthError,
  readUrlEncodedRequest,
  revokeToken,
} from '@/lib/oauth';

export async function POST(request: Request) {
  try {
    const admin = createAdminClient();
    const params = await readUrlEncodedRequest(request);
    const client = await authenticateTokenClient(admin, request, params);
    await revokeToken(admin, client, params);
    return oauthJson({ ok: true });
  } catch (err) {
    if (err instanceof OAuthError) {
      return oauthJson(
        { error: err.code, error_description: err.message },
        { status: err.status }
      );
    }
    return oauthJson(
      {
        error: 'server_error',
        error_description: err instanceof Error ? err.message : 'Token revocation failed',
      },
      { status: 500 }
    );
  }
}

export function OPTIONS() {
  return oauthOptions();
}
