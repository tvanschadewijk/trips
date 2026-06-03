import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types';

type AdminClient = SupabaseClient;

export const OAUTH_SCOPE = 'trips:write';
export const OAUTH_SCOPES = [OAUTH_SCOPE] as const;
export const ACCESS_TOKEN_TTL_SECONDS = 3600;
export const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;
export const AUTH_CODE_TTL_SECONDS = 600;

export type OAuthClientRow = {
  client_id: string;
  client_secret_hash: string | null;
  client_secret_expires_at: string | null;
  client_name: string | null;
  redirect_uris: string[];
  token_endpoint_auth_method: 'none' | 'client_secret_post' | 'client_secret_basic';
  scopes: string[];
  metadata: Record<string, unknown>;
  expires_at: string | null;
};

export class OAuthError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
    public readonly code = 'invalid_request'
  ) {
    super(message);
  }
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

export function generateOpaqueToken(prefix: string): string {
  return `${prefix}_${randomBytes(32).toString('base64url')}`;
}

export function safeEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  return aBuffer.length === bBuffer.length && timingSafeEqual(aBuffer, bBuffer);
}

export function addSeconds(seconds: number): Date {
  return new Date(Date.now() + seconds * 1000);
}

export function parseScopes(scope: string | null | undefined): string[] {
  const scopes = (scope || OAUTH_SCOPE).split(/\s+/).map((s) => s.trim()).filter(Boolean);
  return scopes.length > 0 ? Array.from(new Set(scopes)) : [OAUTH_SCOPE];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item: unknown): item is string => typeof item === 'string')
    : [];
}

function isLoopbackHost(hostname: string): boolean {
  return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname);
}

export function redirectUriIsAllowed(redirectUri: string): boolean {
  try {
    const parsed = new URL(redirectUri);
    return parsed.protocol === 'https:' || (parsed.protocol === 'http:' && isLoopbackHost(parsed.hostname));
  } catch {
    return false;
  }
}

export function assertSupportedScopes(scopes: string[]): void {
  const unsupported = scopes.filter((scope) => !OAUTH_SCOPES.includes(scope as typeof OAUTH_SCOPE));
  if (unsupported.length > 0) {
    throw new OAuthError(`Unsupported scope: ${unsupported.join(', ')}`, 400, 'invalid_scope');
  }
}

export function metadataForAuthorizationServer(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    revocation_endpoint: `${origin}/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: [
      'none',
      'client_secret_post',
      'client_secret_basic',
    ],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: [...OAUTH_SCOPES],
    resource_documentation: `${origin}/guide`,
  };
}

export function metadataForProtectedResource(origin: string) {
  return {
    resource: `${origin}/mcp`,
    authorization_servers: [origin],
    scopes_supported: [...OAUTH_SCOPES],
    resource_name: 'OurTrips MCP',
  };
}

export function oauthJson(body: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.set('Content-Type', 'application/json');
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, MCP-Protocol-Version');
  if (!headers.has('Cache-Control')) {
    headers.set('Cache-Control', 'no-store');
  }
  return new Response(JSON.stringify(body), { ...init, headers });
}

export function oauthOptions(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, MCP-Protocol-Version',
    },
  });
}

export async function registerOAuthClient(admin: AdminClient, metadata: unknown) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new OAuthError('Client metadata must be an object', 400, 'invalid_client_metadata');
  }

  const clientMetadata = metadata as Record<string, unknown>;
  const redirectUris = Array.isArray(clientMetadata.redirect_uris)
    ? clientMetadata.redirect_uris.filter((uri: unknown): uri is string => typeof uri === 'string')
    : [];
  if (redirectUris.length === 0) {
    throw new OAuthError('redirect_uris must include at least one URI', 400, 'invalid_client_metadata');
  }
  if (!redirectUris.every(redirectUriIsAllowed)) {
    throw new OAuthError(
      'redirect_uris must use HTTPS, except loopback HTTP callbacks',
      400,
      'invalid_client_metadata'
    );
  }

  const requestedMethod =
    typeof clientMetadata.token_endpoint_auth_method === 'string'
      ? clientMetadata.token_endpoint_auth_method
      : 'client_secret_post';
  const tokenEndpointAuthMethod = ['none', 'client_secret_post', 'client_secret_basic'].includes(
    requestedMethod
  )
    ? (requestedMethod as OAuthClientRow['token_endpoint_auth_method'])
    : 'client_secret_post';

  const scopes = parseScopes(typeof clientMetadata.scope === 'string' ? clientMetadata.scope : OAUTH_SCOPE);
  assertSupportedScopes(scopes);

  const clientId = generateOpaqueToken('otc');
  const clientSecret =
    tokenEndpointAuthMethod === 'none' ? undefined : generateOpaqueToken('ots');

  const { error } = await admin.from('oauth_clients').insert({
    client_id: clientId,
    client_secret_hash: clientSecret ? sha256(clientSecret) : null,
    client_secret_expires_at: null,
    client_name: typeof clientMetadata.client_name === 'string' ? clientMetadata.client_name : null,
    redirect_uris: redirectUris,
    token_endpoint_auth_method: tokenEndpointAuthMethod,
    scopes,
    metadata: clientMetadata,
    expires_at: null,
  });

  if (error) {
    throw new OAuthError(error.message, 500, 'server_error');
  }

  return {
    client_id: clientId,
    ...(clientSecret
      ? {
          client_secret: clientSecret,
          client_secret_expires_at: 0,
        }
      : {}),
    redirect_uris: redirectUris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: tokenEndpointAuthMethod,
    scope: scopes.join(' '),
    client_name: typeof clientMetadata.client_name === 'string' ? clientMetadata.client_name : 'OurTrips MCP client',
  };
}

export async function readOAuthClient(
  admin: AdminClient,
  clientId: string
): Promise<OAuthClientRow> {
  const { data, error } = await admin
    .from('oauth_clients')
    .select(
      'client_id, client_secret_hash, client_secret_expires_at, client_name, redirect_uris, token_endpoint_auth_method, scopes, metadata, expires_at'
    )
    .eq('client_id', clientId)
    .single();

  if (error || !data) {
    throw new OAuthError('Unknown client_id', 400, 'invalid_client');
  }

  if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) {
    throw new OAuthError('Client registration has expired', 400, 'invalid_client');
  }

  return data as OAuthClientRow;
}

export function redirectUriMatches(requested: string, registered: string): boolean {
  if (requested === registered) return true;

  try {
    const requestedUrl = new URL(requested);
    const registeredUrl = new URL(registered);
    const isLoopback = isLoopbackHost(requestedUrl.hostname) && isLoopbackHost(registeredUrl.hostname);
    return (
      isLoopback &&
      requestedUrl.protocol === registeredUrl.protocol &&
      requestedUrl.hostname === registeredUrl.hostname &&
      requestedUrl.pathname === registeredUrl.pathname
    );
  } catch {
    return false;
  }
}

export function assertRedirectUri(client: OAuthClientRow, redirectUri: string): void {
  if (!client.redirect_uris.some((registered) => redirectUriMatches(redirectUri, registered))) {
    throw new OAuthError('redirect_uri is not registered for this client', 400, 'invalid_request');
  }
}

export function buildOAuthRedirect(
  redirectUri: string,
  params: Record<string, string | undefined>
): Response {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  return Response.redirect(url.toString());
}

export async function createAuthorizationCode(
  admin: AdminClient,
  input: {
    clientId: string;
    userId: string;
    redirectUri: string;
    codeChallenge: string;
    scopes: string[];
    resource?: string;
  }
): Promise<string> {
  const code = generateOpaqueToken('otac');
  const { error } = await admin.from('oauth_authorization_codes').insert({
    code_hash: sha256(code),
    client_id: input.clientId,
    user_id: input.userId,
    redirect_uri: input.redirectUri,
    code_challenge: input.codeChallenge,
    scopes: input.scopes,
    resource: input.resource ?? null,
    expires_at: addSeconds(AUTH_CODE_TTL_SECONDS).toISOString(),
  });

  if (error) {
    throw new OAuthError(error.message, 500, 'server_error');
  }

  return code;
}

export function verifyPkce(codeVerifier: string, codeChallenge: string): boolean {
  return safeEqual(sha256(codeVerifier), codeChallenge);
}

export async function authenticateTokenClient(
  admin: AdminClient,
  request: Request,
  params: URLSearchParams
): Promise<OAuthClientRow> {
  const basic = request.headers.get('authorization');
  let clientId = params.get('client_id') || '';
  let clientSecret = params.get('client_secret') || '';

  if (basic?.startsWith('Basic ')) {
    const decoded = Buffer.from(basic.slice(6), 'base64').toString('utf8');
    const sep = decoded.indexOf(':');
    if (sep >= 0) {
      clientId = decodeURIComponent(decoded.slice(0, sep));
      clientSecret = decodeURIComponent(decoded.slice(sep + 1));
    }
  }

  if (!clientId) {
    throw new OAuthError('client_id is required', 401, 'invalid_client');
  }

  const client = await readOAuthClient(admin, clientId);
  if (client.token_endpoint_auth_method === 'none') {
    return client;
  }

  if (!clientSecret || !client.client_secret_hash) {
    throw new OAuthError('client_secret is required', 401, 'invalid_client');
  }

  if (
    client.client_secret_expires_at &&
    new Date(client.client_secret_expires_at).getTime() <= Date.now()
  ) {
    throw new OAuthError('client_secret has expired', 401, 'invalid_client');
  }

  if (!safeEqual(sha256(clientSecret), client.client_secret_hash)) {
    throw new OAuthError('Invalid client_secret', 401, 'invalid_client');
  }

  return client;
}

export async function exchangeAuthorizationCode(
  admin: AdminClient,
  client: OAuthClientRow,
  params: URLSearchParams
) {
  const code = params.get('code');
  const codeVerifier = params.get('code_verifier');
  const redirectUri = params.get('redirect_uri');
  const resource = params.get('resource') || undefined;

  if (!code || !codeVerifier || !redirectUri) {
    throw new OAuthError('code, code_verifier, and redirect_uri are required', 400, 'invalid_request');
  }

  const { data: authCode, error } = await admin
    .from('oauth_authorization_codes')
    .select('*')
    .eq('code_hash', sha256(code))
    .eq('client_id', client.client_id)
    .single();

  if (error || !authCode) {
    throw new OAuthError('Invalid authorization code', 400, 'invalid_grant');
  }

  if (authCode.consumed_at) {
    throw new OAuthError('Authorization code already used', 400, 'invalid_grant');
  }

  if (new Date(authCode.expires_at).getTime() <= Date.now()) {
    throw new OAuthError('Authorization code expired', 400, 'invalid_grant');
  }

  if (authCode.redirect_uri !== redirectUri) {
    throw new OAuthError('redirect_uri does not match authorization code', 400, 'invalid_grant');
  }

  if (authCode.resource && authCode.resource !== resource) {
    throw new OAuthError('resource does not match authorization code', 400, 'invalid_grant');
  }

  if (!verifyPkce(codeVerifier, authCode.code_challenge)) {
    throw new OAuthError('Invalid PKCE verifier', 400, 'invalid_grant');
  }

  const { error: consumeError } = await admin
    .from('oauth_authorization_codes')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', authCode.id)
    .is('consumed_at', null);

  if (consumeError) {
    throw new OAuthError(consumeError.message, 500, 'server_error');
  }

  return issueTokenPair(admin, {
    clientId: client.client_id,
    userId: authCode.user_id,
    scopes: stringArray(authCode.scopes),
    resource: authCode.resource ?? undefined,
  });
}

export async function refreshTokenPair(
  admin: AdminClient,
  client: OAuthClientRow,
  params: URLSearchParams
) {
  const refreshToken = params.get('refresh_token');
  if (!refreshToken) {
    throw new OAuthError('refresh_token is required', 400, 'invalid_request');
  }

  const { data: token, error } = await admin
    .from('oauth_tokens')
    .select('*')
    .eq('token_hash', sha256(refreshToken))
    .eq('token_type', 'refresh')
    .eq('client_id', client.client_id)
    .single();

  if (error || !token || token.revoked_at || new Date(token.expires_at).getTime() <= Date.now()) {
    throw new OAuthError('Invalid refresh token', 400, 'invalid_grant');
  }

  const tokenScopes = stringArray(token.scopes);
  const requestedScopes: string[] = params.get('scope') ? parseScopes(params.get('scope')) : tokenScopes;
  assertSupportedScopes(requestedScopes);
  const overScoped = requestedScopes.some((scope: string) => !tokenScopes.includes(scope));
  if (overScoped) {
    throw new OAuthError('Refresh token cannot be up-scoped', 400, 'invalid_scope');
  }

  await admin
    .from('oauth_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', token.id);

  return issueTokenPair(admin, {
    clientId: client.client_id,
    userId: token.user_id,
    scopes: requestedScopes,
    resource: token.resource ?? undefined,
    parentRefreshTokenId: token.id,
  });
}

export async function issueTokenPair(
  admin: AdminClient,
  input: {
    clientId: string;
    userId: string;
    scopes: string[];
    resource?: string;
    parentRefreshTokenId?: string;
  }
) {
  assertSupportedScopes(input.scopes);

  const accessToken = generateOpaqueToken('otat');
  const refreshToken = generateOpaqueToken('otrt');
  const accessExpiresAt = addSeconds(ACCESS_TOKEN_TTL_SECONDS);
  const refreshExpiresAt = addSeconds(REFRESH_TOKEN_TTL_SECONDS);

  const { error } = await admin.from('oauth_tokens').insert([
    {
      token_hash: sha256(accessToken),
      token_type: 'access',
      client_id: input.clientId,
      user_id: input.userId,
      scopes: input.scopes,
      resource: input.resource ?? null,
      parent_refresh_token_id: input.parentRefreshTokenId ?? null,
      expires_at: accessExpiresAt.toISOString(),
    },
    {
      token_hash: sha256(refreshToken),
      token_type: 'refresh',
      client_id: input.clientId,
      user_id: input.userId,
      scopes: input.scopes,
      resource: input.resource ?? null,
      parent_refresh_token_id: input.parentRefreshTokenId ?? null,
      expires_at: refreshExpiresAt.toISOString(),
    },
  ]);

  if (error) {
    throw new OAuthError(error.message, 500, 'server_error');
  }

  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refreshToken,
    scope: input.scopes.join(' '),
  };
}

export async function revokeToken(
  admin: AdminClient,
  client: OAuthClientRow,
  params: URLSearchParams
) {
  const token = params.get('token');
  if (!token) {
    throw new OAuthError('token is required', 400, 'invalid_request');
  }

  await admin
    .from('oauth_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('token_hash', sha256(token))
    .eq('client_id', client.client_id);

  return { ok: true };
}

export async function verifyBearerToken(
  admin: AdminClient,
  authorization: string | null,
  requiredScopes: string[] = [OAUTH_SCOPE]
): Promise<AuthInfo> {
  if (!authorization?.startsWith('Bearer ')) {
    throw new OAuthError('Missing bearer token', 401, 'invalid_token');
  }

  const token = authorization.slice(7).trim();
  const { data, error } = await admin
    .from('oauth_tokens')
    .select('id, client_id, user_id, scopes, resource, expires_at, revoked_at')
    .eq('token_hash', sha256(token))
    .eq('token_type', 'access')
    .single();

  if (error || !data || data.revoked_at || new Date(data.expires_at).getTime() <= Date.now()) {
    throw new OAuthError('Invalid bearer token', 401, 'invalid_token');
  }

  const scopes = stringArray(data.scopes);
  const missingScope = requiredScopes.find((scope) => !scopes.includes(scope));
  if (missingScope) {
    throw new OAuthError(`Missing required scope: ${missingScope}`, 403, 'insufficient_scope');
  }

  await admin
    .from('oauth_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id);

  return {
    token,
    clientId: data.client_id,
    scopes,
    expiresAt: Math.floor(new Date(data.expires_at).getTime() / 1000),
    resource: data.resource ? new URL(data.resource) : undefined,
    extra: { userId: data.user_id },
  };
}

export function mcpUnauthorizedResponse(origin: string, error = 'invalid_token'): Response {
  return oauthJson(
    { error },
    {
      status: 401,
      headers: {
        'WWW-Authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", scope="${OAUTH_SCOPE}", error="${error}"`,
      },
    }
  );
}

export async function readUrlEncodedRequest(request: Request): Promise<URLSearchParams> {
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const body = await request.json();
    return new URLSearchParams(
      Object.entries(body as Record<string, unknown>)
        .filter(([, value]) => value !== undefined && value !== null)
        .map(([key, value]) => [key, String(value)])
    );
  }

  const text = await request.text();
  return new URLSearchParams(text);
}
