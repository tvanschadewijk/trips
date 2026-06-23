import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { validateApiKey } from '@/lib/auth';
import {
  listTripsForUser,
  saveTripForUser,
  TripServiceError,
} from '@/lib/trip-service';

// POST /api/trips — Create or update a trip
export async function POST(request: NextRequest) {
  const userId = await validateApiKey(request.headers.get('authorization'));
  if (!userId) {
    return NextResponse.json({ error: 'Invalid or missing API key' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const supabase = createAdminClient();
    const result = await saveTripForUser(supabase, userId, body, request.nextUrl.origin);
    return NextResponse.json(result, {
      status: result.status === 'created' ? 201 : 200,
    });
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    if (err instanceof TripServiceError) {
      return NextResponse.json(
        { error: err.message, code: err.code, details: err.details },
        { status: err.status }
      );
    }

    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to save trip' },
      { status: 500 }
    );
  }
}

// GET /api/trips — List all trips for authenticated user
export async function GET(request: NextRequest) {
  const userId = await validateApiKey(request.headers.get('authorization'));
  if (!userId) {
    return NextResponse.json({ error: 'Invalid or missing API key' }, { status: 401 });
  }

  const supabase = createAdminClient();

  try {
    const trips = await listTripsForUser(supabase, userId, request.nextUrl.origin);
    return NextResponse.json({ trips });
  } catch (err) {
    if (err instanceof TripServiceError) {
      return NextResponse.json(
        { error: err.message, code: err.code, details: err.details },
        { status: err.status }
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to list trips' },
      { status: 500 }
    );
  }
}
