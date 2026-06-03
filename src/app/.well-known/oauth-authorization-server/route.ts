import { metadataForAuthorizationServer, oauthJson, oauthOptions } from '@/lib/oauth';

export async function GET(request: Request) {
  return oauthJson(metadataForAuthorizationServer(new URL(request.url).origin));
}

export function OPTIONS() {
  return oauthOptions();
}
