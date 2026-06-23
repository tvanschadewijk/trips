import { NextRequest, NextResponse } from 'next/server';
import { getBillingSummary } from '@/lib/billing';
import { createStripePortalSession } from '@/lib/stripe';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

function appOrigin(request: NextRequest): string {
  return (
    process.env.OURTRIPS_PUBLIC_ORIGIN?.trim()
    || process.env.NEXT_PUBLIC_SITE_URL?.trim()
    || request.nextUrl.origin
  ).replace(/\/+$/, '');
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const billing = await getBillingSummary(createAdminClient(), user.id);
    if (!billing.stripe_customer_id) {
      return NextResponse.json(
        { error: 'No Stripe customer exists for this account yet.' },
        { status: 400 }
      );
    }

    const origin = appOrigin(request);
    const session = await createStripePortalSession({
      customerId: billing.stripe_customer_id,
      returnUrl: `${origin}/dashboard?billing=portal`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to open billing portal.' },
      { status: 500 }
    );
  }
}
