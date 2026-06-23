# OurTrips Monetization Plan

## Packaging

OurTrips uses a freemium trip-count model:

- Free: 3 personal trips.
- Pro: unlimited personal trip creation, billed through Stripe.
- Early adopter: the first 500 users can lock in 3 years for €29.95.

The limit is enforced server-side before any new trip insert. Existing trips can still be opened, edited, synced, and shared.

## Stripe Setup

Create or rename the Stripe sandbox to `ourtrips.to`.

Create one product:

- Product: `OurTrips Pro`

Create two recurring prices:

- `OurTrips Pro Monthly`: EUR, recurring monthly. The app copy defaults to `€7.95/month`; use `OURTRIPS_PRO_PRICE_LABEL` if the Stripe price differs.
- `OurTrips Early Adopter`: EUR 29.95, recurring every 3 years. The app reserves a first-500 slot before Checkout starts and marks it paid from the webhook.

Required environment variables:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRO_PRICE_ID`
- `STRIPE_EARLY_ADOPTER_PRICE_ID`
- `OURTRIPS_PUBLIC_ORIGIN=https://ourtrips.to`

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
- Fourth-trip moment: shows the hard paywall only when the user tries to create the fourth trip.
- Settings menu: exposes billing only after a Stripe customer exists.
- Copy: use “early adopter” and “founder deal” language, with remaining spots visible as social proof.

## Launch Tactics

Prioritize product-led channels:

- Early access pricing: mention the first-500 deal in changelog and founder posts.
- In-app upsells: keep the dashboard meter visible after the first trip.
- Founder welcome email: tell new users they have 3 trips included and can lock the 3-year deal before the 500 spots are gone.
- Public demos and changelogs: show real trips made with OurTrips and pair the update with the founder deal.
