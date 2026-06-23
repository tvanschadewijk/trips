type StripeFormValue = string | number | boolean | null | undefined;

export type StripeCheckoutSession = {
  id: string;
  url: string | null;
  customer?: string | null;
  subscription?: string | null;
  metadata?: Record<string, string>;
  payment_status?: string;
  status?: string;
};

export type StripeCustomer = {
  id: string;
};

export type StripePortalSession = {
  id: string;
  url: string;
};

export type StripeSubscription = {
  id: string;
  customer?: string | { id?: string } | null;
  status?: string;
  cancel_at_period_end?: boolean;
  current_period_end?: number;
  metadata?: Record<string, string>;
  items?: {
    data?: Array<{
      current_period_end?: number;
      price?: {
        id?: string;
      };
    }>;
  };
};

export type StripeEvent = {
  id: string;
  type: string;
  data: {
    object: Record<string, unknown>;
  };
};

const STRIPE_API_BASE = 'https://api.stripe.com/v1';
const WEBHOOK_TOLERANCE_SECONDS = 300;

function getStripeSecretKey(): string {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured.');
  return key;
}

function appendFormValue(params: URLSearchParams, key: string, value: StripeFormValue) {
  if (value === undefined || value === null) return;
  params.append(key, String(value));
}

async function stripeRequest<T>(path: string, values: Record<string, StripeFormValue> = {}): Promise<T> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    appendFormValue(params, key, value);
  }

  const response = await fetch(`${STRIPE_API_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getStripeSecretKey()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof json?.error?.message === 'string'
      ? json.error.message
      : `Stripe HTTP ${response.status}`;
    throw new Error(message);
  }

  return json as T;
}

async function stripeGet<T>(path: string): Promise<T> {
  const response = await fetch(`${STRIPE_API_BASE}${path}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${getStripeSecretKey()}`,
    },
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof json?.error?.message === 'string'
      ? json.error.message
      : `Stripe HTTP ${response.status}`;
    throw new Error(message);
  }

  return json as T;
}

export function getStripePriceId(plan: 'pro' | 'early_adopter'): string {
  const envKey = plan === 'early_adopter'
    ? 'STRIPE_EARLY_ADOPTER_PRICE_ID'
    : 'STRIPE_PRO_PRICE_ID';
  const priceId = process.env[envKey]?.trim();
  if (!priceId) throw new Error(`${envKey} is not configured.`);
  return priceId;
}

export async function createStripeCustomer(args: {
  email?: string | null;
  userId: string;
}): Promise<StripeCustomer> {
  return stripeRequest<StripeCustomer>('/customers', {
    email: args.email || undefined,
    'metadata[ourtrips_user_id]': args.userId,
  });
}

export async function createStripeCheckoutSession(args: {
  customerId: string;
  userId: string;
  plan: 'pro' | 'early_adopter';
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  reservationId?: string | null;
}): Promise<StripeCheckoutSession> {
  return stripeRequest<StripeCheckoutSession>('/checkout/sessions', {
    mode: 'subscription',
    customer: args.customerId,
    client_reference_id: args.userId,
    success_url: args.successUrl,
    cancel_url: args.cancelUrl,
    'line_items[0][price]': args.priceId,
    'line_items[0][quantity]': 1,
    'metadata[ourtrips_user_id]': args.userId,
    'metadata[ourtrips_plan]': args.plan,
    'metadata[early_adopter_reservation_id]': args.reservationId || undefined,
    'subscription_data[metadata][ourtrips_user_id]': args.userId,
    'subscription_data[metadata][ourtrips_plan]': args.plan,
    'subscription_data[metadata][early_adopter_reservation_id]': args.reservationId || undefined,
  });
}

export async function createStripePortalSession(args: {
  customerId: string;
  returnUrl: string;
}): Promise<StripePortalSession> {
  return stripeRequest<StripePortalSession>('/billing_portal/sessions', {
    customer: args.customerId,
    return_url: args.returnUrl,
  });
}

export async function retrieveStripeSubscription(subscriptionId: string): Promise<StripeSubscription> {
  return stripeGet<StripeSubscription>(`/subscriptions/${encodeURIComponent(subscriptionId)}`);
}

export function stripeSubscriptionCustomerId(subscription: StripeSubscription): string | null {
  if (typeof subscription.customer === 'string') return subscription.customer;
  if (subscription.customer && typeof subscription.customer === 'object') {
    return typeof subscription.customer.id === 'string' ? subscription.customer.id : null;
  }
  return null;
}

export function stripeSubscriptionPriceId(subscription: StripeSubscription): string | null {
  const item = subscription.items?.data?.[0];
  return item?.price?.id ?? null;
}

export function stripeSubscriptionPeriodEnd(subscription: StripeSubscription): string | null {
  const periodEnd = subscription.current_period_end ?? subscription.items?.data?.[0]?.current_period_end;
  return typeof periodEnd === 'number' ? new Date(periodEnd * 1000).toISOString() : null;
}

function parseStripeSignatureHeader(header: string): { timestamp: string | null; signatures: string[] } {
  const parts = header.split(',').map((part) => part.trim());
  const timestamp = parts.find((part) => part.startsWith('t='))?.slice(2) ?? null;
  const signatures = parts
    .filter((part) => part.startsWith('v1='))
    .map((part) => part.slice(3));
  return { timestamp, signatures };
}

function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function verifyStripeWebhookEvent(payload: string, signatureHeader: string | null): Promise<StripeEvent> {
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!endpointSecret) throw new Error('STRIPE_WEBHOOK_SECRET is not configured.');
  if (!signatureHeader) throw new Error('Missing Stripe-Signature header.');

  const { timestamp, signatures } = parseStripeSignatureHeader(signatureHeader);
  if (!timestamp || signatures.length === 0) throw new Error('Invalid Stripe-Signature header.');

  const timestampNumber = Number(timestamp);
  if (!Number.isFinite(timestampNumber)) throw new Error('Invalid Stripe signature timestamp.');
  const age = Math.abs(Date.now() / 1000 - timestampNumber);
  if (age > WEBHOOK_TOLERANCE_SECONDS) throw new Error('Stripe signature timestamp is outside the tolerance window.');

  const expected = await hmacSha256Hex(endpointSecret, `${timestamp}.${payload}`);
  if (!signatures.some((signature) => safeEqual(signature, expected))) {
    throw new Error('Stripe webhook signature verification failed.');
  }

  return JSON.parse(payload) as StripeEvent;
}
