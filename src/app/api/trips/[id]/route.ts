import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { validateApiKey } from '@/lib/auth';
import {
  getTripForUser,
  patchTripForUser,
  softDeleteTripForUser,
  TripServiceError,
} from '@/lib/trip-service';

async function resolveUserId(request: NextRequest): Promise<string | null> {
  const apiUserId = await validateApiKey(request.headers.get('authorization'));
  if (apiUserId) return apiUserId;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

// GET /api/trips/[id] — Get a single trip's full JSON
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await resolveUserId(request);
  if (!userId) {
    return NextResponse.json({ error: 'Invalid or missing API key' }, { status: 401 });
  }

  const { id } = await params;
  const supabase = createAdminClient();

  try {
    const trip = await getTripForUser(supabase, userId, id);
    return NextResponse.json(trip);
  } catch (err) {
    if (err instanceof TripServiceError) {
      return NextResponse.json(
        { error: err.message, code: err.code, details: err.details },
        { status: err.status }
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch trip' },
      { status: 500 }
    );
  }
}

// PATCH /api/trips/[id] — Partially update a trip (deep-merge)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await resolveUserId(request);
  if (!userId) {
    return NextResponse.json({ error: 'Invalid or missing API key' }, { status: 401 });
  }

  const { id } = await params;
  const supabase = createAdminClient();

  try {
    const body = await request.json();
    const updated = await patchTripForUser(supabase, userId, id, body);
    return NextResponse.json(updated);
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
      { error: err instanceof Error ? err.message : 'Failed to update trip' },
      { status: 500 }
    );
  }
}

// DELETE /api/trips/[id] — Soft-delete a trip
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await resolveUserId(request);
  if (!userId) {
    return NextResponse.json({ error: 'Invalid or missing API key' }, { status: 401 });
  }

  const { id } = await params;
  const supabase = createAdminClient();

  try {
    const deleted = await softDeleteTripForUser(supabase, userId, id, {
      source: 'api',
      tool: 'delete_trip',
    });
    return NextResponse.json({
      status: 'deleted',
      deleted_at: deleted.deleted_at,
    });
  } catch (err) {
    if (err instanceof TripServiceError) {
      return NextResponse.json(
        { error: err.message, code: err.code, details: err.details },
        { status: err.status }
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to delete trip' },
      { status: 500 }
    );
  }
}
