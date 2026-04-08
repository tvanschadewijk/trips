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
  const granularity = url.searchParams.get('granularity') || 'month';

  const supabase = createAdminClient();

  function bucketKey(date: Date): string {
    if (granularity === 'day') {
      return date.toISOString().split('T')[0];
    }
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  // --- Users ---
  const { data: { users: allUsers } } = await supabase.auth.admin.listUsers({ perPage: 10000 });
  const users = allUsers || [];

  const usersByBucket: Record<string, number> = {};
  for (const u of users) {
    const key = bucketKey(new Date(u.created_at));
    usersByBucket[key] = (usersByBucket[key] || 0) + 1;
  }

  // Fill in all days for daily granularity so chart has no gaps
  let sortedBuckets: string[];
  if (granularity === 'day' && from && to) {
    sortedBuckets = [];
    const d = new Date(from);
    const end = new Date(to);
    while (d <= end) {
      sortedBuckets.push(d.toISOString().split('T')[0]);
      d.setDate(d.getDate() + 1);
    }
  } else {
    sortedBuckets = Object.keys(usersByBucket).sort();
  }

  // For daily view, start cumulative from users created before the range
  let cumulative = 0;
  if (granularity === 'day' && from) {
    cumulative = users.filter(u => new Date(u.created_at) < new Date(from)).length;
  }
  const usersPerBucket = sortedBuckets.map(bucket => {
    const newUsers = usersByBucket[bucket] || 0;
    cumulative += newUsers;
    return { bucket, new_users: newUsers, total_users: cumulative };
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

  const tripsByBucket: Record<string, number> = {};
  for (const t of allTrips) {
    const key = bucketKey(new Date(t.created_at));
    tripsByBucket[key] = (tripsByBucket[key] || 0) + 1;
  }

  const tripBuckets = granularity === 'day' && from && to ? sortedBuckets : Object.keys(tripsByBucket).sort();
  const tripsPerBucket = tripBuckets.map(bucket => ({
    bucket,
    trips: tripsByBucket[bucket] || 0,
  }));

  let filteredNewUsers = users.length;
  if (from || to) {
    filteredNewUsers = users.filter(u => {
      const d = new Date(u.created_at);
      if (from && d < new Date(from)) return false;
      if (to && d > new Date(to + 'T23:59:59.999Z')) return false;
      return true;
    }).length;
  }

  return NextResponse.json({
    granularity,
    users: {
      total: users.length,
      new_in_range: filteredNewUsers,
      per_bucket: usersPerBucket,
    },
    trips: {
      total: totalTrips,
      unique_users_with_trips: uniqueTripUsers,
      avg_per_user: Math.round(avgTripsPerUser * 100) / 100,
      per_bucket: tripsPerBucket,
    },
    range: { from: from || null, to: to || null },
  });
}
