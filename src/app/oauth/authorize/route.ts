import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import {
  assertRedirectUri,
  assertSupportedScopes,
  buildOAuthRedirect,
  createAuthorizationCode,
  oauthOptions,
  OAuthError,
  parseScopes,
  readOAuthClient,
  readUrlEncodedRequest,
} from '@/lib/oauth';

type AuthorizeRequest = {
  clientId: string;
  redirectUri: string;
  state?: string;
  codeChallenge: string;
  scopes: string[];
  resource?: string;
  clientName: string;
};

function htmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function normalizeResource(origin: string, resource: string | null): string | undefined {
  if (!resource) return undefined;
  try {
    const parsed = new URL(resource);
    if (`${parsed.origin}${parsed.pathname}` === `${origin}/mcp`) {
      return `${origin}/mcp`;
    }
  } catch {
    // handled below
  }
  throw new OAuthError('Unsupported resource', 400, 'invalid_target');
}

async function validateAuthorizeParams(
  origin: string,
  params: URLSearchParams
): Promise<AuthorizeRequest> {
  const responseType = params.get('response_type');
  const clientId = params.get('client_id');
  const redirectUri = params.get('redirect_uri');
  const codeChallenge = params.get('code_challenge');
  const codeChallengeMethod = params.get('code_challenge_method');

  if (responseType !== 'code') {
    throw new OAuthError('response_type must be code', 400, 'unsupported_response_type');
  }
  if (!clientId || !redirectUri || !codeChallenge) {
    throw new OAuthError('client_id, redirect_uri, and code_challenge are required');
  }
  if (codeChallengeMethod !== 'S256') {
    throw new OAuthError('code_challenge_method must be S256');
  }

  const admin = createAdminClient();
  const client = await readOAuthClient(admin, clientId);
  assertRedirectUri(client, redirectUri);

  const scopes = parseScopes(params.get('scope'));
  assertSupportedScopes(scopes);

  return {
    clientId,
    redirectUri,
    state: params.get('state') || undefined,
    codeChallenge,
    scopes,
    resource: normalizeResource(origin, params.get('resource')),
    clientName: client.client_name || 'OurTrips MCP client',
  };
}

function consentHtml(input: AuthorizeRequest): Response {
  const hidden = [
    ['response_type', 'code'],
    ['client_id', input.clientId],
    ['redirect_uri', input.redirectUri],
    ['code_challenge', input.codeChallenge],
    ['code_challenge_method', 'S256'],
    ['scope', input.scopes.join(' ')],
    ['state', input.state || ''],
    ['resource', input.resource || ''],
    ['approve', '1'],
  ]
    .map(
      ([name, value]) =>
        `<input type="hidden" name="${htmlEscape(name)}" value="${htmlEscape(value)}">`
    )
    .join('\n');

  const body = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Connect OurTrips</title>
  <style>
    :root {
      color-scheme: light;
      --paper: #FBF7F1;
      --ink: #1A1410;
      --ink-70: #3D352E;
      --ink-50: #6B6157;
      --rule: #E8E1D6;
      --terracotta: #C14F2A;
      --terracotta-deep: #A03E1F;
    }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: var(--paper);
      color: var(--ink);
      font-family: Inter, "SF Pro Text", system-ui, -apple-system, Segoe UI, sans-serif;
    }
    main {
      width: min(520px, calc(100vw - 48px));
      background: #fff;
      border: 1px solid var(--rule);
      border-radius: 4px;
      box-shadow: rgba(26, 20, 16, 0.04) 0 1px 0 0, rgba(26, 20, 16, 0.06) 0 4px 16px -4px;
      padding: 40px;
    }
    .eyebrow {
      margin: 0 0 16px;
      color: var(--terracotta);
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.14em;
      text-transform: uppercase;
    }
    h1 {
      margin: 0;
      font-family: Fraunces, "Iowan Old Style", Palatino, Georgia, serif;
      font-size: 32px;
      font-weight: 420;
      line-height: 1.15;
      letter-spacing: -0.012em;
    }
    p {
      color: var(--ink-70);
      font-size: 16px;
      line-height: 1.6;
      margin: 18px 0 0;
    }
    .scope {
      margin: 24px 0;
      padding: 16px;
      background: #F4EDE2;
      border-radius: 4px;
      color: var(--ink-50);
      font-size: 14px;
    }
    button {
      appearance: none;
      border: 0;
      border-radius: 999px;
      background: var(--terracotta);
      color: var(--paper);
      cursor: pointer;
      font: 580 14px/1 Inter, "SF Pro Text", system-ui, sans-serif;
      padding: 14px 24px;
    }
    button:hover { background: var(--terracotta-deep); }
  </style>
</head>
<body>
  <main>
    <p class="eyebrow">OurTrips connection</p>
    <h1>Connect ${htmlEscape(input.clientName)}</h1>
    <p>This lets the connected agent save, list, read, and update trips in your OurTrips account.</p>
    <div class="scope">Scope: ${htmlEscape(input.scopes.join(' '))}</div>
    <form method="post" action="/oauth/authorize">
      ${hidden}
      <button type="submit">Connect OurTrips</button>
    </form>
  </main>
</body>
</html>`;

  return new Response(body, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

async function getCurrentUserId(): Promise<string | null> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user?.id ?? null;
  } catch {
    return null;
  }
}

async function completeAuthorization(input: AuthorizeRequest, userId: string): Promise<Response> {
  const code = await createAuthorizationCode(createAdminClient(), {
    clientId: input.clientId,
    userId,
    redirectUri: input.redirectUri,
    codeChallenge: input.codeChallenge,
    scopes: input.scopes,
    resource: input.resource,
  });

  return buildOAuthRedirect(input.redirectUri, {
    code,
    state: input.state,
  });
}

function errorResponse(err: unknown): Response {
  if (err instanceof OAuthError) {
    return new Response(`${err.code}: ${err.message}`, {
      status: err.status,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
  return new Response(err instanceof Error ? err.message : 'Authorization failed', {
    status: 500,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const input = await validateAuthorizeParams(url.origin, url.searchParams);
    const userId = await getCurrentUserId();
    if (!userId) {
      return Response.redirect(
        `${url.origin}/login?next=${encodeURIComponent(`${url.pathname}${url.search}`)}`
      );
    }
    return consentHtml(input);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    const params = await readUrlEncodedRequest(request);
    const input = await validateAuthorizeParams(url.origin, params);
    if (params.get('approve') !== '1') {
      return buildOAuthRedirect(input.redirectUri, {
        error: 'access_denied',
        state: input.state,
      });
    }

    const userId = await getCurrentUserId();
    if (!userId) {
      const query = params.toString();
      return Response.redirect(
        `${url.origin}/login?next=${encodeURIComponent(`${url.pathname}?${query}`)}`
      );
    }

    return completeAuthorization(input, userId);
  } catch (err) {
    return errorResponse(err);
  }
}

export function OPTIONS() {
  return oauthOptions();
}
