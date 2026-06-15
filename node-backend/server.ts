import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { GET, POST } from './trip-chat-route';

const DEFAULT_PORT = 8788;
const port = Number(process.env.PORT ?? DEFAULT_PORT);

const server = createServer(async (incoming, outgoing) => {
  try {
    const response = await handleRequest(incoming);
    await writeResponse(outgoing, response);
  } catch (err) {
    console.error('trip-chat-backend: unhandled request error', err);
    await writeResponse(
      outgoing,
      json({ error: 'Internal Server Error' }, { status: 500 })
    );
  }
});

server.listen(port, () => {
  console.log(`trip-chat-backend: listening on http://localhost:${port}`);
});

async function handleRequest(incoming: IncomingMessage): Promise<Response> {
  const request = nodeRequestToWebRequest(incoming);
  const url = new URL(request.url);

  if (url.pathname === '/healthz') {
    const missing = requiredEnv().filter((key) => !process.env[key]);
    return json(
      {
        ok: missing.length === 0,
        service: 'trip-chat-backend',
        missing,
      },
      { status: missing.length === 0 ? 200 : 503 }
    );
  }

  const secretResponse = enforceSharedSecret(request);
  if (secretResponse) return secretResponse;

  const match = url.pathname.match(/^\/api\/trips\/([^/]+)\/chat\/?$/);
  if (!match) {
    return json({ error: 'Not Found' }, { status: 404 });
  }

  const id = decodeURIComponent(match[1]);
  const context = { params: Promise.resolve({ id }) };

  if (request.method === 'GET') {
    return GET(request, context);
  }

  if (request.method === 'POST') {
    return POST(request, context);
  }

  if (request.method === 'HEAD') {
    return new Response(null, { status: 204 });
  }

  return json({ error: 'Method Not Allowed' }, {
    status: 405,
    headers: { allow: 'GET, POST, HEAD' },
  });
}

function enforceSharedSecret(request: Request): Response | null {
  const expected = process.env.OURTRIPS_CHAT_BACKEND_SECRET;
  if (!expected) return null;

  const actual = request.headers.get('x-ourtrips-chat-backend-secret');
  if (actual === expected) return null;

  return json({ error: 'Forbidden' }, { status: 403 });
}

function nodeRequestToWebRequest(incoming: IncomingMessage): Request {
  const host = incoming.headers.host ?? `localhost:${port}`;
  const proto = headerValue(incoming.headers['x-forwarded-proto']) ?? 'http';
  const url = new URL(incoming.url ?? '/', `${proto}://${host}`);
  const headers = new Headers();

  for (const [key, value] of Object.entries(incoming.headers)) {
    if (Array.isArray(value)) {
      value.forEach((item) => headers.append(key, item));
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }

  const init: RequestInit & { duplex?: 'half' } = {
    method: incoming.method ?? 'GET',
    headers,
  };

  if (init.method !== 'GET' && init.method !== 'HEAD') {
    init.body = incoming as unknown as BodyInit;
    init.duplex = 'half';
  }

  return new Request(url, init);
}

async function writeResponse(outgoing: ServerResponse, response: Response): Promise<void> {
  const headers: Record<string, string | string[]> = {};
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() !== 'set-cookie') {
      headers[key] = value;
    }
  });

  const setCookies = getSetCookieHeaders(response.headers);
  if (setCookies.length > 0) {
    headers['set-cookie'] = setCookies;
  }

  outgoing.writeHead(response.status, headers);
  if (response.body) {
    const body = Buffer.from(await response.arrayBuffer());
    outgoing.end(body);
  } else {
    outgoing.end();
  }
}

function getSetCookieHeaders(headers: Headers): string[] {
  const withGetter = headers as Headers & { getSetCookie?: () => string[] };
  if (withGetter.getSetCookie) {
    return withGetter.getSetCookie();
  }
  const value = headers.get('set-cookie');
  return value ? [value] : [];
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function requiredEnv(): string[] {
  return [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
  ];
}

function json(data: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.set('content-type', 'application/json');
  return new Response(JSON.stringify(data), {
    ...init,
    headers,
  });
}
