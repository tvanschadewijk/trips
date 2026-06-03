import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp';
import { createOurTripsMcpServer } from '@/lib/ourtrips-mcp';
import { OAuthError, mcpUnauthorizedResponse, oauthOptions, verifyBearerToken } from '@/lib/oauth';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

async function handleMcpRequest(request: Request): Promise<Response> {
  const origin = new URL(request.url).origin;
  const admin = createAdminClient();

  let authInfo;
  try {
    authInfo = await verifyBearerToken(admin, request.headers.get('authorization'));
  } catch (err) {
    const code = err instanceof OAuthError ? err.code : 'invalid_token';
    return mcpUnauthorizedResponse(origin, code);
  }

  const server = createOurTripsMcpServer(origin);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  try {
    await server.connect(transport);
    return await transport.handleRequest(request, { authInfo });
  } finally {
    await transport.close();
    await server.close();
  }
}

export async function GET(request: Request) {
  return handleMcpRequest(request);
}

export async function POST(request: Request) {
  return handleMcpRequest(request);
}

export async function DELETE(request: Request) {
  return handleMcpRequest(request);
}

export function OPTIONS() {
  return oauthOptions();
}
