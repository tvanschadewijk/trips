import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 300;

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'content-length',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

export async function GET(request: NextRequest) {
  return proxyToNodeChatBackend(request);
}

export async function POST(request: NextRequest) {
  return proxyToNodeChatBackend(request);
}

async function proxyToNodeChatBackend(request: NextRequest): Promise<Response> {
  const backendOrigin = process.env.OURTRIPS_NODE_BACKEND_ORIGIN?.replace(/\/+$/, '');
  if (!backendOrigin) {
    return NextResponse.json(
      {
        error: 'Trip chat backend is not configured',
        detail: 'Set OURTRIPS_NODE_BACKEND_ORIGIN to a Node-compatible OurTrips deployment.',
      },
      { status: 503 }
    );
  }

  const incomingUrl = new URL(request.url);
  const targetUrl = new URL(`${incomingUrl.pathname}${incomingUrl.search}`, `${backendOrigin}/`);
  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  });
  headers.set('x-forwarded-host', incomingUrl.host);
  headers.set('x-forwarded-proto', incomingUrl.protocol.replace(':', ''));
  if (process.env.OURTRIPS_CHAT_BACKEND_SECRET) {
    headers.set('x-ourtrips-chat-backend-secret', process.env.OURTRIPS_CHAT_BACKEND_SECRET);
  }

  const init: RequestInit & { duplex?: 'half' } = {
    method: request.method,
    headers,
    redirect: 'manual',
  };

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body;
    init.duplex = 'half';
  }

  return fetch(targetUrl, init);
}
