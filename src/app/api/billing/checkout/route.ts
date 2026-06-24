import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getBillingSummary } from '@/lib/billing';
import {
  createStripeCheckoutSession,
  createStripeCustomer,
  getStripePriceId,
} from '@/lib/stripe';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const CheckoutBodySchema = z.object({
  plan: z.enum(['pro', 'early_adopter']),
});

type EarlyAdopterReservationResult = {
  reservation_id: string;
  reservation_number: number;
  claimed_count: number;
  remaining_count: number;
};

function appOrigin(request: NextRequest): string {
  return (
    process.env.OURTRIPS_PUBLIC_ORIGIN?.trim()
    || process.env.NEXT_PUBLIC_SITE_URL?.trim()
    || request.nextUrl.origin
  ).replace(/\/+$/, '');
}

function stripeConfigError(err: unknown): NextResponse {
  return NextResponse.json(
    { error: err instanceof Error ? err.message : 'Stripe is not configured yet.' },
    { status: 500 }
  );
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const parsed = CheckoutBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Choose a valid billing plan.', detail: parsed.error.message },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const plan = parsed.data.plan;
  const origin = appOrigin(request);

  let summary = await getBillingSummary(admin, user.id);
  if (!summary.billing_enabled) {
    return NextResponse.json(
      { error: 'Billing is not enabled yet.', code: 'billing_not_enabled', billing: summary },
      { status: 503 }
    );
  }

  if (summary.access_active && !summary.is_admin) {
    return NextResponse.json(
      { error: 'Billing is already active for this account.', code: 'billing_active', billing: summary },
      { status: 409 }
    );
  }

  let reservation: EarlyAdopterReservationResult | null = null;
  if (plan === 'early_adopter') {
    if (!summary.early_adopter.available) {
      return NextResponse.json(
        { error: 'The early adopter deal is no longer available.', code: 'early_adopter_sold_out', billing: summary },
        { status: 409 }
      );
    }

    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const { data, error } = await admin.rpc('reserve_early_adopter_deal', {
      p_user_id: user.id,
      p_expires_at: expiresAt,
    });

    if (error) {
      summary = await getBillingSummary(admin, user.id);
      return NextResponse.json(
        { error: 'The early adopter deal is no longer available.', code: 'early_adopter_sold_out', billing: summary },
        { status: 409 }
      );
    }

    reservation = Array.isArray(data) ? data[0] as EarlyAdopterReservationResult : null;
    if (!reservation?.reservation_id) {
      return NextResponse.json(
        { error: 'Could not reserve an early adopter slot.' },
        { status: 500 }
      );
    }
  }

  let priceId: string;
  try {
    priceId = getStripePriceId(plan);
  } catch (err) {
    return stripeConfigError(err);
  }

  let customerId = summary.stripe_customer_id;
  try {
    if (!customerId) {
      const customer = await createStripeCustomer({
        email: user.email,
        userId: user.id,
      });
      customerId = customer.id;
      await admin
        .from('profiles')
        .upsert({
          id: user.id,
          stripe_customer_id: customerId,
          billing_updated_at: new Date().toISOString(),
        });
    }

    const checkout = await createStripeCheckoutSession({
      customerId,
      userId: user.id,
      plan,
      priceId,
      successUrl: `${origin}/dashboard?billing=success`,
      cancelUrl: `${origin}/dashboard?billing=cancelled`,
      reservationId: reservation?.reservation_id ?? null,
    });

    if (reservation) {
      await admin
        .from('billing_early_adopter_reservations')
        .update({
          stripe_checkout_session_id: checkout.id,
          stripe_customer_id: customerId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', reservation.reservation_id)
        .eq('user_id', user.id);
    }

    return NextResponse.json({ url: checkout.url, id: checkout.id });
  } catch (err) {
    if (reservation) {
      await admin
        .from('billing_early_adopter_reservations')
        .update({ status: 'released', updated_at: new Date().toISOString() })
        .eq('id', reservation.reservation_id)
        .eq('status', 'reserved');
    }

    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to start checkout.' },
      { status: 500 }
    );
  }
}
