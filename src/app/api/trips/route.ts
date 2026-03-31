import { NextRequest, NextResponse } from 'next/server';

// POST /api/trips — Create or update a trip
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { trip, days } = body;

    if (!trip?.name) {
      return NextResponse.json({ error: 'Trip name is required' }, { status: 400 });
    }

    // TODO: When Supabase is connected:
    // 1. Validate API key from Authorization header
    // 2. Upsert trip data into Supabase
    // 3. Return share URL

    // For now, return a mock response
    const shareId = Math.random().toString(36).substring(2, 12);
    return NextResponse.json({
      trip_id: crypto.randomUUID(),
      share_id: shareId,
      url: `${request.nextUrl.origin}/t/${shareId}`,
      status: 'created',
    }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
}

// GET /api/trips — List all trips for authenticated user
export async function GET() {
  // TODO: When Supabase is connected:
  // 1. Validate API key from Authorization header
  // 2. Fetch user's trips from Supabase

  return NextResponse.json({
    trips: [
      {
        trip_id: 'sample-1',
        name: 'Scotland',
        share_id: 'sample123',
        url: '/t/sample123',
        updated_at: new Date().toISOString(),
      },
    ],
  });
}
