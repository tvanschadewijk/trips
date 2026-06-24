#!/usr/bin/env node

const STRIPE_API_BASE = 'https://api.stripe.com/v1';
const PRODUCT_NAME = process.env.OURTRIPS_STRIPE_PRODUCT_NAME || 'OurTrips Pro';
const PRODUCT_METADATA_KEY = 'ourtrips_app';
const PRODUCT_METADATA_VALUE = 'ourtrips';
const PRO_LOOKUP_KEY = process.env.STRIPE_PRO_LOOKUP_KEY || 'ourtrips_pro_monthly';
const EARLY_LOOKUP_KEY = process.env.STRIPE_EARLY_ADOPTER_LOOKUP_KEY || 'ourtrips_early_adopter_3y';
const PRO_AMOUNT_CENTS = Number(process.env.OURTRIPS_PRO_MONTHLY_AMOUNT_CENTS || 795);
const EARLY_AMOUNT_CENTS = Number(process.env.OURTRIPS_EARLY_ADOPTER_AMOUNT_CENTS || 2995);
const PUBLIC_ORIGIN = (process.env.OURTRIPS_PUBLIC_ORIGIN || 'https://ourtrips.to').replace(/\/+$/, '');
const WEBHOOK_URL = process.env.STRIPE_WEBHOOK_URL || `${PUBLIC_ORIGIN}/api/stripe/webhook`;
const WEBHOOK_EVENTS = [
  'checkout.session.completed',
  'checkout.session.expired',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_succeeded',
];

function usage() {
  console.log(`Usage:
  STRIPE_SECRET_KEY=sk_test_... npm run stripe:setup

Optional env:
  OURTRIPS_PUBLIC_ORIGIN=https://ourtrips.to
  OURTRIPS_PRO_MONTHLY_AMOUNT_CENTS=795
  OURTRIPS_EARLY_ADOPTER_AMOUNT_CENTS=2995
  STRIPE_PRO_LOOKUP_KEY=${PRO_LOOKUP_KEY}
  STRIPE_EARLY_ADOPTER_LOOKUP_KEY=${EARLY_LOOKUP_KEY}
  STRIPE_WEBHOOK_URL=${WEBHOOK_URL}
`);
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  usage();
  process.exit(0);
}

const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
if (!secretKey) {
  console.error('STRIPE_SECRET_KEY is required. Use a Stripe sandbox/test secret key.');
  usage();
  process.exit(1);
}

if (!Number.isInteger(PRO_AMOUNT_CENTS) || PRO_AMOUNT_CENTS <= 0) {
  console.error('OURTRIPS_PRO_MONTHLY_AMOUNT_CENTS must be a positive integer.');
  process.exit(1);
}

if (!Number.isInteger(EARLY_AMOUNT_CENTS) || EARLY_AMOUNT_CENTS <= 0) {
  console.error('OURTRIPS_EARLY_ADOPTER_AMOUNT_CENTS must be a positive integer.');
  process.exit(1);
}

function formBody(entries) {
  const body = new URLSearchParams();
  for (const [key, value] of entries) {
    if (value === undefined || value === null) continue;
    body.append(key, String(value));
  }
  return body;
}

async function stripe(method, path, entries = []) {
  const body = method === 'GET' ? null : formBody(entries);
  const url = new URL(`${STRIPE_API_BASE}${path}`);
  if (method === 'GET') {
    for (const [key, value] of entries) {
      if (value === undefined || value === null) continue;
      url.searchParams.append(key, String(value));
    }
  }

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body,
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = json?.error?.message || `Stripe HTTP ${response.status}`;
    throw new Error(message);
  }
  return json;
}

async function listAll(path, entries = []) {
  const results = [];
  let startingAfter = null;

  do {
    const page = await stripe('GET', path, [
      ...entries,
      ['limit', 100],
      ['starting_after', startingAfter],
    ]);
    results.push(...(page.data || []));
    startingAfter = page.has_more && page.data?.length ? page.data[page.data.length - 1].id : null;
  } while (startingAfter);

  return results;
}

async function ensureProduct() {
  const products = await listAll('/products', [['active', true]]);
  const existing = products.find((product) =>
    product.metadata?.[PRODUCT_METADATA_KEY] === PRODUCT_METADATA_VALUE ||
    product.name === PRODUCT_NAME
  );

  if (existing) {
    return { product: existing, created: false };
  }

  const product = await stripe('POST', '/products', [
    ['name', PRODUCT_NAME],
    ['description', 'OurTrips Pro subscription access'],
    [`metadata[${PRODUCT_METADATA_KEY}]`, PRODUCT_METADATA_VALUE],
  ]);

  return { product, created: true };
}

async function pricesByLookupKeys() {
  const prices = await stripe('GET', '/prices', [
    ['active', true],
    ['lookup_keys[]', PRO_LOOKUP_KEY],
    ['lookup_keys[]', EARLY_LOOKUP_KEY],
  ]);
  return new Map((prices.data || []).map((price) => [price.lookup_key, price]));
}

async function ensurePrice({ productId, lookupKey, nickname, amount, interval, intervalCount }) {
  const existing = (await pricesByLookupKeys()).get(lookupKey);
  if (existing) return { price: existing, created: false };

  const price = await stripe('POST', '/prices', [
    ['product', productId],
    ['currency', 'eur'],
    ['unit_amount', amount],
    ['lookup_key', lookupKey],
    ['nickname', nickname],
    ['recurring[interval]', interval],
    ['recurring[interval_count]', intervalCount],
    ['recurring[usage_type]', 'licensed'],
    [`metadata[${PRODUCT_METADATA_KEY}]`, PRODUCT_METADATA_VALUE],
  ]);

  return { price, created: true };
}

async function ensureWebhookEndpoint() {
  const endpoints = await listAll('/webhook_endpoints');
  const existing = endpoints.find((endpoint) => endpoint.url === WEBHOOK_URL && !endpoint.deleted);
  if (existing) return { endpoint: existing, created: false };

  const endpoint = await stripe('POST', '/webhook_endpoints', [
    ['url', WEBHOOK_URL],
    ...WEBHOOK_EVENTS.map((event) => ['enabled_events[]', event]),
    [`metadata[${PRODUCT_METADATA_KEY}]`, PRODUCT_METADATA_VALUE],
  ]);

  return { endpoint, created: true };
}

const productResult = await ensureProduct();
const proResult = await ensurePrice({
  productId: productResult.product.id,
  lookupKey: PRO_LOOKUP_KEY,
  nickname: 'OurTrips Pro Monthly',
  amount: PRO_AMOUNT_CENTS,
  interval: 'month',
  intervalCount: 1,
});
const earlyResult = await ensurePrice({
  productId: productResult.product.id,
  lookupKey: EARLY_LOOKUP_KEY,
  nickname: 'OurTrips Early Adopter - 3 years',
  amount: EARLY_AMOUNT_CENTS,
  interval: 'year',
  intervalCount: 3,
});
const webhookResult = await ensureWebhookEndpoint();

console.log(`Stripe billing setup complete.

Product:
  ${productResult.created ? 'created' : 'existing'} ${productResult.product.id} ${productResult.product.name}

Prices:
  ${proResult.created ? 'created' : 'existing'} STRIPE_PRO_PRICE_ID=${proResult.price.id}
  ${earlyResult.created ? 'created' : 'existing'} STRIPE_EARLY_ADOPTER_PRICE_ID=${earlyResult.price.id}

Webhook:
  ${webhookResult.created ? 'created' : 'existing'} ${webhookResult.endpoint.id} ${webhookResult.endpoint.url}
`);

console.log('Environment values for OurTrips:');
console.log(`STRIPE_PRO_PRICE_ID=${proResult.price.id}`);
console.log(`STRIPE_EARLY_ADOPTER_PRICE_ID=${earlyResult.price.id}`);
if (webhookResult.created && webhookResult.endpoint.secret) {
  console.log(`STRIPE_WEBHOOK_SECRET=${webhookResult.endpoint.secret}`);
} else {
  console.log('STRIPE_WEBHOOK_SECRET=<copy the endpoint signing secret from Stripe Workbench>');
}
console.log(`OURTRIPS_PUBLIC_ORIGIN=${PUBLIC_ORIGIN}`);
console.log('OURTRIPS_BILLING_ENABLED=true # set only after the Supabase billing migration and Cloudflare secrets are ready');
