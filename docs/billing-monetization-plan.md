# OurTrips Monetization Plan

## Packaging

OurTrips uses a freemium trip-count model:

- Free: 3 personal trips.
- Pro: unlimited personal trip creation, billed through Stripe.
- Early adopter: the first 500 users can lock in €2,49 per month, paid annually (€29,88/year).

The limit is enforced server-side before any new trip insert. Existing trips can still be opened, edited, synced, and shared.

Billing is gated by `OURTRIPS_BILLING_ENABLED`. Leave it unset or set to `false` while Stripe, Cloudflare secrets, and the Supabase billing migration are still being prepared. Set it to `true` only as the final launch switch.

## Stripe Setup

Create or rename the Stripe sandbox to `ourtrips.to`.

If you have a Stripe sandbox secret key available locally, run:

```bash
STRIPE_SECRET_KEY=sk_test_... OURTRIPS_PUBLIC_ORIGIN=https://ourtrips.to npm run stripe:setup
```

The script creates or reuses the product, both prices, and the webhook endpoint, then prints the price IDs and webhook secret to put into Cloudflare.

Create one product:

- Product: `OurTrips Pro`

Create two recurring prices:

- `OurTrips Pro Monthly`: EUR, recurring monthly. The app copy defaults to `€7.95/month`; use `OURTRIPS_PRO_PRICE_LABEL` if the Stripe price differs.
- `OurTrips Early Adopter`: EUR 29.88, recurring yearly. The app presents this as `€2,49/month, paid annually`, reserves a first-500 slot before Checkout starts, and marks it paid from the webhook.

Required environment variables:

- `OURTRIPS_BILLING_ENABLED=true`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRO_PRICE_ID`
- `STRIPE_EARLY_ADOPTER_PRICE_ID`
- `OURTRIPS_PUBLIC_ORIGIN=https://ourtrips.to`

Optional setup variables:

- `OURTRIPS_PRO_MONTHLY_AMOUNT_CENTS=795`
- `OURTRIPS_EARLY_ADOPTER_AMOUNT_CENTS=2988`
- `OURTRIPS_EARLY_ADOPTER_BILLING_NOTE=paid annually`

Webhook endpoint:

- `https://ourtrips.to/api/stripe/webhook`

Events handled:

- `checkout.session.completed`
- `checkout.session.expired`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_succeeded`

## In-Product Promotion

The early adopter offer should feel like a founding-user thank-you, not a blocking ad.

- Dashboard panel: shows the free trip meter and the early adopter offer while users still have free trips left.
- Pricing page draft: presents the early adopter plan as €2,49 per month, paid annually, with the annual total visible nearby. Keep it outside public routes until launch timing and copy are approved.
- Fourth-trip moment: shows the hard paywall only when the user tries to create the fourth trip.
- Settings menu: exposes billing only after a Stripe customer exists.
- Copy: use “early adopter” and “founder deal” language, with remaining spots visible as social proof.

When `OURTRIPS_BILLING_ENABLED` is off, the dashboard offer, checkout links, billing portal, webhook processing, and fourth-trip enforcement stay disabled even if Stripe secrets are present.

## Launch Tactics

Prioritize product-led channels:

- Early access pricing: mention the first-500 deal in changelog and founder posts.
- In-app upsells: keep the dashboard meter visible after the first trip.
- Founder welcome email: tell new users they have 3 trips included and can lock the annual early adopter price before the 500 spots are gone.
- Public demos and changelogs: show real trips made with OurTrips and pair the update with the founder deal.
