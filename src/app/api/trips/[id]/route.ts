import { NextResponse } from 'next/server';

// GET /api/trips/[id] — Get a single trip's full JSON
export async function GET() {
  // TODO: Fetch from Supabase by trip ID
  return NextResponse.json({ error: 'Not implemented yet — connect Supabase' }, { status: 501 });
}

// DELETE /api/trips/[id] — Delete a trip
export async function DELETE() {
  // TODO: Delete from Supabase
  return NextResponse.json({ error: 'Not implemented yet — connect Supabase' }, { status: 501 });
}
