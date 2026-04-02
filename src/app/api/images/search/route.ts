import { NextRequest, NextResponse } from 'next/server';

const UNSPLASH_API = 'https://api.unsplash.com/search/photos';

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get('query');
  if (!query) {
    return NextResponse.json({ error: 'Missing ?query= parameter' }, { status: 400 });
  }

  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) {
    return NextResponse.json({ error: 'UNSPLASH_ACCESS_KEY not configured' }, { status: 500 });
  }

  const orientation = req.nextUrl.searchParams.get('orientation') || 'landscape';

  const url = new URL(UNSPLASH_API);
  url.searchParams.set('query', query);
  url.searchParams.set('per_page', '3');
  url.searchParams.set('orientation', orientation);

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Client-ID ${key}` },
    next: { revalidate: 86400 },
  });

  if (!res.ok) {
    const body = await res.text();
    return NextResponse.json({ error: 'Unsplash API error', detail: body }, { status: res.status });
  }

  const data = await res.json();
  const results = (data.results || []).map((photo: Record<string, unknown>) => {
    const urls = photo.urls as Record<string, string>;
    const links = photo.links as Record<string, string>;
    const user = photo.user as Record<string, unknown>;
    const userLinks = (user?.links || {}) as Record<string, string>;
    // Use the raw URL base (without Unsplash tracking params) per API guidelines
    const base = (urls.raw || '').split('?')[0];
    return {
      id: photo.id as string,
      landscape: `${base}?w=800&h=500&fit=crop&q=80`,
      portrait: `${base}?w=1200&h=1600&fit=crop&q=80`,
      download_url: links.download_location || '',
      description: (photo.description || photo.alt_description || '') as string,
      photographer: (user?.name || '') as string,
      photographer_url: `${userLinks.html || ''}?utm_source=trips&utm_medium=referral`,
    };
  });

  return NextResponse.json({ query, results });
}

/** Trigger Unsplash download tracking — call when user selects a photo */
export async function POST(req: NextRequest) {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) {
    return NextResponse.json({ error: 'UNSPLASH_ACCESS_KEY not configured' }, { status: 500 });
  }

  const { download_url } = await req.json();
  if (!download_url) {
    return NextResponse.json({ error: 'Missing download_url' }, { status: 400 });
  }

  await fetch(download_url, {
    headers: { Authorization: `Client-ID ${key}` },
  });

  return NextResponse.json({ ok: true });
}
