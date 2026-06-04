import { NextRequest, NextResponse } from 'next/server';
import {
  searchTripImages,
  trackTripImageDownload,
  TripServiceError,
} from '@/lib/trip-service';

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get('query');
  if (!query) {
    return NextResponse.json({ error: 'Missing ?query= parameter' }, { status: 400 });
  }

  const rawOrientation = req.nextUrl.searchParams.get('orientation') || 'landscape';
  const orientation = ['landscape', 'portrait', 'squarish'].includes(rawOrientation)
    ? (rawOrientation as 'landscape' | 'portrait' | 'squarish')
    : 'landscape';

  try {
    return NextResponse.json(await searchTripImages(query, orientation));
  } catch (err) {
    if (err instanceof TripServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'Unsplash API error' }, { status: 500 });
  }
}

/** Trigger Unsplash download tracking — call when user selects a photo */
export async function POST(req: NextRequest) {
  const { download_url } = await req.json();
  if (!download_url) {
    return NextResponse.json({ error: 'Missing download_url' }, { status: 400 });
  }

  try {
    return NextResponse.json(await trackTripImageDownload(download_url));
  } catch (err) {
    if (err instanceof TripServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'Unsplash download tracking failed' }, { status: 500 });
  }
}
