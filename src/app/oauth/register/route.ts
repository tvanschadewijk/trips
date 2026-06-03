import { createAdminClient } from '@/lib/supabase/admin';
import {
  oauthJson,
  oauthOptions,
  OAuthError,
  registerOAuthClient,
} from '@/lib/oauth';

export async function POST(request: Request) {
  try {
    const metadata = await request.json();
    const client = await registerOAuthClient(createAdminClient(), metadata);
    return oauthJson(client, { status: 201 });
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
        error_description: err instanceof Error ? err.message : 'Failed to register client',
      },
      { status: 500 }
    );
  }
}

export function OPTIONS() {
  return oauthOptions();
}
