import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  retrieveStripeSubscription,
  stripeSubscriptionCustomerId,
  stripeSubscriptionPeriodEnd,
  stripeSubscriptionPriceId,
  type StripeCheckoutSession,
  type StripeSubscription,
  verifyStripeWebhookEvent,
} from '@/lib/stripe';
import { isBillingFeatureEnabled } from '@/lib/billing';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

type AdminClient = SupabaseClient;
type PaidPlan = 'pro' | 'early_adopter';

function asStripeCheckoutSession(value: Record<string, unknown>): StripeCheckoutSession {
  return value as StripeCheckoutSession;
}

function asStripeSubscription(value: Record<string, unknown>): StripeSubscription {
  return value as StripeSubscription;
}

function planFromStripe(metadataPlan: string | undefined, priceId: string | null): PaidPlan {
  if (metadataPlan === 'early_adopter') return 'early_adopter';
  if (metadataPlan === 'pro') return 'pro';

  const earlyAdopterPriceId = process.env.STRIPE_EARLY_ADOPTER_PRICE_ID?.trim();
  const proPriceId = process.env.STRIPE_PRO_PRICE_ID?.trim();
  if (priceId && earlyAdopterPriceId && priceId === earlyAdopterPriceId) return 'early_adopter';
  if (priceId && proPriceId && priceId === proPriceId) return 'pro';
  return 'pro';
}

async function userIdForSubscription(
  admin: AdminClient,
  subscription: StripeSubscription
): Promise<string | null> {
  const metadataUserId = subscription.metadata?.ourtrips_user_id;
  if (metadataUserId) return metadataUserId;

  const { data } = await admin
    .from('profiles')
    .select('id')
    .eq('stripe_subscription_id', subscription.id)
    .maybeSingle();

  return typeof data?.id === 'string' ? data.id : null;
}

async function markEarlyAdopterPaid(args: {
  admin: AdminClient;
  userId: string;
  reservationId?: string | null;
  checkoutSessionId?: string | null;
  subscriptionId: string;
  customerId: string | null;
  periodEnd: string | null;
}) {
  const now = new Date().toISOString();
  const reservationUpdate: Record<string, unknown> = {
    status: 'paid',
    stripe_subscription_id: args.subscriptionId,
    stripe_customer_id: args.customerId,
    paid_at: now,
    updated_at: now,
  };
  if (args.checkoutSessionId) {
    reservationUpdate.stripe_checkout_session_id = args.checkoutSessionId;
  }

  let query = args.admin
    .from('billing_early_adopter_reservations')
    .update(reservationUpdate)
    .eq('user_id', args.userId);

  if (args.reservationId) {
    query = query.eq('id', args.reservationId);
  } else if (args.checkoutSessionId) {
    query = query.eq('stripe_checkout_session_id', args.checkoutSessionId);
  } else {
    query = query.eq('stripe_subscription_id', args.subscriptionId);
  }

  const { data } = await query
    .select('reservation_number')
    .maybeSingle();

  const profileUpdate: Record<string, unknown> = {
    billing_updated_at: now,
  };
  if (typeof data?.reservation_number === 'number') {
    profileUpdate.early_adopter_claim_number = data.reservation_number;
  }
  if (args.periodEnd) {
    profileUpdate.early_adopter_expires_at = args.periodEnd;
  }

  await args.admin
    .from('profiles')
    .update(profileUpdate)
    .eq('id', args.userId);
}

async function syncSubscriptionProfile(args: {
  admin: AdminClient;
  subscription: StripeSubscription;
  fallbackUserId?: string | null;
  fallbackPlan?: PaidPlan | null;
  checkoutSessionId?: string | null;
  reservationId?: string | null;
}) {
  const userId = args.fallbackUserId ?? await userIdForSubscription(args.admin, args.subscription);
  if (!userId) return;

  const customerId = stripeSubscriptionCustomerId(args.subscription);
  const priceId = stripeSubscriptionPriceId(args.subscription);
  const plan = args.fallbackPlan ?? planFromStripe(args.subscription.metadata?.ourtrips_plan, priceId);
  const periodEnd = stripeSubscriptionPeriodEnd(args.subscription);
  const now = new Date().toISOString();

  await args.admin
    .from('profiles')
    .upsert({
      id: userId,
      stripe_customer_id: customerId,
      stripe_subscription_id: args.subscription.id,
      billing_plan: plan,
      billing_status: args.subscription.status ?? 'unknown',
      billing_price_id: priceId,
      billing_current_period_end: periodEnd,
      billing_cancel_at_period_end: Boolean(args.subscription.cancel_at_period_end),
      billing_updated_at: now,
    });

  if (plan === 'early_adopter') {
    await markEarlyAdopterPaid({
      admin: args.admin,
      userId,
      reservationId: args.reservationId ?? args.subscription.metadata?.early_adopter_reservation_id,
      checkoutSessionId: args.checkoutSessionId,
      subscriptionId: args.subscription.id,
      customerId,
      periodEnd,
    });
  }
}

async function handleCheckoutCompleted(admin: AdminClient, session: StripeCheckoutSession) {
  const userId = session.metadata?.ourtrips_user_id;
  const subscriptionId = typeof session.subscription === 'string' ? session.subscription : null;
  if (!userId || !subscriptionId) return;

  const plan = planFromStripe(session.metadata?.ourtrips_plan, null);
  const subscription = await retrieveStripeSubscription(subscriptionId);

  await syncSubscriptionProfile({
    admin,
    subscription,
    fallbackUserId: userId,
    fallbackPlan: plan,
    checkoutSessionId: session.id,
    reservationId: session.metadata?.early_adopter_reservation_id,
  });
}

async function handleCheckoutExpired(admin: AdminClient, session: StripeCheckoutSession) {
  await admin
    .from('billing_early_adopter_reservations')
    .update({ status: 'released', updated_at: new Date().toISOString() })
    .eq('stripe_checkout_session_id', session.id)
    .eq('status', 'reserved');
}

async function handleInvoicePaymentSucceeded(admin: AdminClient, object: Record<string, unknown>) {
  const subscriptionId = typeof object.subscription === 'string' ? object.subscription : null;
  if (!subscriptionId) return;

  const subscription = await retrieveStripeSubscription(subscriptionId);
  await syncSubscriptionProfile({ admin, subscription });
}

export async function POST(request: NextRequest) {
  if (!isBillingFeatureEnabled()) {
    return NextResponse.json({ received: true, ignored: true, code: 'billing_disabled' });
  }

  const payload = await request.text();

  let event;
  try {
    event = await verifyStripeWebhookEvent(payload, request.headers.get('stripe-signature'));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Invalid Stripe webhook.' },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(admin, asStripeCheckoutSession(event.data.object));
        break;
      case 'checkout.session.expired':
        await handleCheckoutExpired(admin, asStripeCheckoutSession(event.data.object));
        break;
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await syncSubscriptionProfile({
          admin,
          subscription: asStripeSubscription(event.data.object),
        });
        break;
      case 'invoice.payment_succeeded':
        await handleInvoicePaymentSucceeded(admin, event.data.object);
        break;
      default:
        break;
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to process Stripe webhook.' },
      { status: 500 }
    );
  }

  return NextResponse.json({ received: true });
}
