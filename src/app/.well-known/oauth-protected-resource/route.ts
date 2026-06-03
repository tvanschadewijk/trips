import { metadataForProtectedResource, oauthJson, oauthOptions } from '@/lib/oauth';

export async function GET(request: Request) {
  return oauthJson(metadataForProtectedResource(new URL(request.url).origin));
}

export function OPTIONS() {
  return oauthOptions();
}
