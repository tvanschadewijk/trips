import { createAdminClient } from '@/lib/supabase/admin';
import {
  authenticateTokenClient,
  exchangeAuthorizationCode,
  oauthJson,
  oauthOptions,
  OAuthError,
  readUrlEncodedRequest,
  refreshTokenPair,
} from '@/lib/oauth';

export async function POST(request: Request) {
  try {
    const admin = createAdminClient();
    const params = await readUrlEncodedRequest(request);
    const client = await authenticateTokenClient(admin, request, params);
    const grantType = params.get('grant_type');

    if (grantType === 'authorization_code') {
      return oauthJson(await exchangeAuthorizationCode(admin, client, params));
    }

    if (grantType === 'refresh_token') {
      return oauthJson(await refreshTokenPair(admin, client, params));
    }

    return oauthJson(
      { error: 'unsupported_grant_type', error_description: 'Unsupported grant_type' },
      { status: 400 }
    );
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
        error_description: err instanceof Error ? err.message : 'Token exchange failed',
      },
      { status: 500 }
    );
  }
}

export function OPTIONS() {
  return oauthOptions();
}
