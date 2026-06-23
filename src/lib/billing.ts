import type { SupabaseClient } from '@supabase/supabase-js';
import { publicItineraryShareIds } from '@/lib/public-itineraries';

type AdminClient = SupabaseClient;

export const FREE_TRIP_LIMIT = 3;
export const EARLY_ADOPTER_LIMIT = 500;
export const EARLY_ADOPTER_YEARS = 3;
export const EARLY_ADOPTER_PRICE_LABEL = '€29.95';
export const PRO_PRICE_LABEL = '€7.95/month';

export type BillingPlan = 'free' | 'pro' | 'early_adopter' | 'admin';

export type BillingProfile = {
  id: string;
  role?: string | null;
  billing_schema_ready?: boolean;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  billing_plan?: string | null;
  billing_status?: string | null;
  billing_price_id?: string | null;
  billing_current_period_end?: string | null;
  billing_cancel_at_period_end?: boolean | null;
  early_adopter_claim_number?: number | null;
  early_adopter_expires_at?: string | null;
};

export type BillingSummary = {
  billing_enabled: boolean;
  plan: BillingPlan;
  status: string;
  is_admin: boolean;
  access_active: boolean;
  can_create_trip: boolean;
  trip_count: number;
  free_trip_limit: number;
  trips_remaining: number;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  pro: {
    price_label: string;
  };
  early_adopter: {
    price_label: string;
    years: number;
    limit: number;
    claimed: number;
    remaining: number;
    available: boolean;
    claim_number: number | null;
    expires_at: string | null;
  };
};

type EarlyAdopterReservation = {
  status: string | null;
  expires_at: string | null;
};

type EarlyAdopterClaimCount = {
  claimed: number;
  schemaReady: boolean;
};

const ACTIVE_BILLING_STATUSES = new Set(['active', 'trialing']);
const GRACE_BILLING_STATUSES = new Set(['past_due']);

function billingConfigReady(): boolean {
  return Boolean(
    process.env.STRIPE_SECRET_KEY?.trim()
    && process.env.STRIPE_WEBHOOK_SECRET?.trim()
    && process.env.STRIPE_PRO_PRICE_ID?.trim()
    && process.env.STRIPE_EARLY_ADOPTER_PRICE_ID?.trim()
  );
}

function isMissingBillingSchemaError(error: { message?: string } | null | undefined): boolean {
  const message = error?.message ?? '';
  return /billing_|stripe_|early_adopter|does not exist|schema cache/iu.test(message);
}

function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

export function billingProfileHasActiveAccess(profile: BillingProfile | null, now = new Date()): boolean {
  if (!profile) return false;
  if (profile.role === 'admin') return true;

  const status = profile.billing_status ?? 'free';
  const currentPeriodEnd = parseTimestamp(profile.billing_current_period_end);
  const earlyAdopterExpiresAt = parseTimestamp(profile.early_adopter_expires_at);
  const nowTime = now.getTime();

  if (ACTIVE_BILLING_STATUSES.has(status)) return true;
  if (GRACE_BILLING_STATUSES.has(status) && currentPeriodEnd !== null && currentPeriodEnd > nowTime) {
    return true;
  }

  return earlyAdopterExpiresAt !== null && earlyAdopterExpiresAt > nowTime;
}

export function normalizeBillingPlan(profile: BillingProfile | null, accessActive: boolean): BillingPlan {
  if (profile?.role === 'admin') return 'admin';
  if (!accessActive) return 'free';
  if (profile?.billing_plan === 'early_adopter' || profile?.early_adopter_claim_number) return 'early_adopter';
  if (profile?.billing_plan === 'pro') return 'pro';
  return 'free';
}

export async function countPersonalTrips(admin: AdminClient, userId: string): Promise<number> {
  const { data, error } = await admin
    .from('trips')
    .select('share_id')
    .eq('user_id', userId);

  if (error) throw new Error(error.message);

  return (data ?? []).filter((trip) => {
    const shareId = typeof trip.share_id === 'string' ? trip.share_id : null;
    return !shareId || !publicItineraryShareIds.includes(shareId);
  }).length;
}

export async function loadBillingProfile(admin: AdminClient, userId: string): Promise<BillingProfile | null> {
  const { data, error } = await admin
    .from('profiles')
    .select([
      'id',
      'role',
      'stripe_customer_id',
      'stripe_subscription_id',
      'billing_plan',
      'billing_status',
      'billing_price_id',
      'billing_current_period_end',
      'billing_cancel_at_period_end',
      'early_adopter_claim_number',
      'early_adopter_expires_at',
    ].join(', '))
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    if (!isMissingBillingSchemaError(error)) throw new Error(error.message);

    const fallback = await admin
      .from('profiles')
      .select('id, role')
      .eq('id', userId)
      .maybeSingle();

    if (fallback.error) throw new Error(fallback.error.message);
    return fallback.data
      ? { ...(fallback.data as unknown as BillingProfile), billing_schema_ready: false }
      : null;
  }

  return data ? { ...(data as unknown as BillingProfile), billing_schema_ready: true } : null;
}

async function countEarlyAdopterClaims(admin: AdminClient, now = new Date()): Promise<EarlyAdopterClaimCount> {
  const { data, error } = await admin
    .from('billing_early_adopter_reservations')
    .select('status, expires_at');

  if (error) {
    if (isMissingBillingSchemaError(error)) return { claimed: 0, schemaReady: false };
    throw new Error(error.message);
  }

  const nowTime = now.getTime();
  const claimed = ((data ?? []) as EarlyAdopterReservation[]).filter((claim) => {
    if (claim.status === 'paid') return true;
    if (claim.status !== 'reserved') return false;
    const expiresAt = parseTimestamp(claim.expires_at);
    return expiresAt !== null && expiresAt > nowTime;
  }).length;

  return { claimed, schemaReady: true };
}

export async function getBillingSummary(admin: AdminClient, userId: string): Promise<BillingSummary> {
  const now = new Date();
  const [profile, tripCount, earlyAdopterClaims] = await Promise.all([
    loadBillingProfile(admin, userId),
    countPersonalTrips(admin, userId),
    countEarlyAdopterClaims(admin, now),
  ]);

  const isAdmin = profile?.role === 'admin';
  const schemaReady = (profile?.billing_schema_ready ?? true) && earlyAdopterClaims.schemaReady;
  const enabled = billingConfigReady() && schemaReady;
  const accessActive = billingProfileHasActiveAccess(profile, now);
  const tripsRemaining = Math.max(0, FREE_TRIP_LIMIT - tripCount);
  const plan = normalizeBillingPlan(profile, accessActive);
  const earlyAdopterRemaining = Math.max(0, EARLY_ADOPTER_LIMIT - earlyAdopterClaims.claimed);

  return {
    billing_enabled: enabled,
    plan,
    status: profile?.billing_status ?? (isAdmin ? 'admin' : 'free'),
    is_admin: isAdmin,
    access_active: accessActive,
    can_create_trip: !enabled || accessActive || tripCount < FREE_TRIP_LIMIT,
    trip_count: tripCount,
    free_trip_limit: FREE_TRIP_LIMIT,
    trips_remaining: tripsRemaining,
    stripe_customer_id: profile?.stripe_customer_id ?? null,
    stripe_subscription_id: profile?.stripe_subscription_id ?? null,
    current_period_end: profile?.billing_current_period_end ?? profile?.early_adopter_expires_at ?? null,
    cancel_at_period_end: Boolean(profile?.billing_cancel_at_period_end),
    pro: {
      price_label: process.env.OURTRIPS_PRO_PRICE_LABEL?.trim() || PRO_PRICE_LABEL,
    },
    early_adopter: {
      price_label: process.env.OURTRIPS_EARLY_ADOPTER_PRICE_LABEL?.trim() || EARLY_ADOPTER_PRICE_LABEL,
      years: EARLY_ADOPTER_YEARS,
      limit: EARLY_ADOPTER_LIMIT,
      claimed: earlyAdopterClaims.claimed,
      remaining: earlyAdopterRemaining,
      available: enabled && earlyAdopterRemaining > 0 && plan !== 'early_adopter',
      claim_number: profile?.early_adopter_claim_number ?? null,
      expires_at: profile?.early_adopter_expires_at ?? null,
    },
  };
}
