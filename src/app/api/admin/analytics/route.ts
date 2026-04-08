import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

async function isAdmin(userId: string): Promise<boolean> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single();
  return data?.role === 'admin';
}

export async function GET(request: NextRequest) {
  // Authenticate via session
  const serverClient = await createClient();
  const { data: { user } } = await serverClient.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!(await isAdmin(user.id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const url = new URL(request.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');

  const supabase = createAdminClient();

  // --- Users per month ---
  // Get all users from auth.users via admin API
  const { data: { users: allUsers } } = await supabase.auth.admin.listUsers({ perPage: 10000 });
  const users = allUsers || [];

  // Build monthly user counts
  const usersByMonth: Record<string, number> = {};
  for (const u of users) {
    const created = new Date(u.created_at);
    const key = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, '0')}`;
    usersByMonth[key] = (usersByMonth[key] || 0) + 1;
  }

  // Sort months and compute cumulative totals
  const sortedMonths = Object.keys(usersByMonth).sort();
  let cumulative = 0;
  const usersPerMonth = sortedMonths.map(month => {
    cumulative += usersByMonth[month];
    return { month, new_users: usersByMonth[month], total_users: cumulative };
  });

  // --- Trips ---
  let tripsQuery = supabase.from('trips').select('id, user_id, created_at');
  if (from) tripsQuery = tripsQuery.gte('created_at', from);
  if (to) tripsQuery = tripsQuery.lte('created_at', to + 'T23:59:59.999Z');

  const { data: trips } = await tripsQuery;
  const allTrips = trips || [];

  const totalTrips = allTrips.length;
  const uniqueTripUsers = new Set(allTrips.map(t => t.user_id)).size;
  const avgTripsPerUser = uniqueTripUsers > 0 ? totalTrips / uniqueTripUsers : 0;

  // Trips per month
  const tripsByMonth: Record<string, number> = {};
  for (const t of allTrips) {
    const created = new Date(t.created_at);
    const key = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, '0')}`;
    tripsByMonth[key] = (tripsByMonth[key] || 0) + 1;
  }

  const tripMonths = Object.keys(tripsByMonth).sort();
  const tripsPerMonth = tripMonths.map(month => ({
    month,
    trips: tripsByMonth[month],
  }));

  // Filter users by date range if provided
  let filteredTotalUsers = users.length;
  let filteredNewUsers = users.length;
  if (from || to) {
    const filtered = users.filter(u => {
      const d = new Date(u.created_at);
      if (from && d < new Date(from)) return false;
      if (to && d > new Date(to + 'T23:59:59.999Z')) return false;
      return true;
    });
    filteredNewUsers = filtered.length;
  }

  return NextResponse.json({
    users: {
      total: users.length,
      new_in_range: filteredNewUsers,
      per_month: usersPerMonth,
    },
    trips: {
      total: totalTrips,
      unique_users_with_trips: uniqueTripUsers,
      avg_per_user: Math.round(avgTripsPerUser * 100) / 100,
      per_month: tripsPerMonth,
    },
    range: { from: from || null, to: to || null },
  });
}
