/* eslint-disable @next/next/no-img-element */

import Link from 'next/link';
import {
  Check,
  Compass,
  CreditCard,
  Infinity as InfinityIcon,
  Sparkles,
  TicketPercent,
} from 'lucide-react';
import AppTopBar from '@/components/ui/AppTopBar';
import {
  EARLY_ADOPTER_ANNUAL_PRICE_LABEL,
  EARLY_ADOPTER_BILLING_NOTE,
  EARLY_ADOPTER_LIMIT,
  EARLY_ADOPTER_PRICE_LABEL,
  FREE_TRIP_LIMIT,
  PRO_PRICE_LABEL,
  isBillingFeatureEnabled,
} from '@/lib/billing';

function monthlyAmount(label: string): string {
  return label.replace('/month', '').trim();
}

export default function PricingPageDraft() {
  const billingEnabled = isBillingFeatureEnabled();
  const earlyPriceLabel = process.env.OURTRIPS_EARLY_ADOPTER_PRICE_LABEL?.trim() || EARLY_ADOPTER_PRICE_LABEL;
  const earlyBillingNote = process.env.OURTRIPS_EARLY_ADOPTER_BILLING_NOTE?.trim() || EARLY_ADOPTER_BILLING_NOTE;
  const proPriceLabel = process.env.OURTRIPS_PRO_PRICE_LABEL?.trim() || PRO_PRICE_LABEL;
  const startHref = '/login?next=/dashboard%3Fagent%3Dnew';
  const earlyHref = billingEnabled ? '/login?next=/dashboard' : startHref;

  return (
    <div className="pricing-page">
      <AppTopBar
        suffix="Pricing"
        actions={
          <div className="pricing-nav-links">
            <Link href="/itineraries" className="pricing-nav-link">Examples</Link>
            <Link href="/blog" className="pricing-nav-link">Journal</Link>
            <Link href="/login" className="pricing-btn-outline">Log in</Link>
          </div>
        }
      />

      <main>
        <section className="pricing-hero">
          <div className="pricing-hero-copy">
            <div className="pricing-kicker">Pricing</div>
            <h1>Start with a real trip, then choose what feels right.</h1>
            <p>
              OurTrips is meant to earn its place in your travel routine. Plan a few trips,
              see how the guide works on the road, and upgrade only when you want more room
              to keep planning.
            </p>
          </div>
          <figure className="pricing-product-preview">
            <img src="/og-image.png" alt="OurTrips itinerary preview" />
            <figcaption>Built for real routes, saved decisions, and portable day-by-day guides.</figcaption>
          </figure>
        </section>

        <section className="pricing-plans" aria-label="OurTrips plans">
          <article className="pricing-card">
            <div className="pricing-card-icon">
              <Compass size={18} aria-hidden="true" />
            </div>
            <div className="pricing-card-head">
              <p className="pricing-card-label">Explore</p>
              <h2>{FREE_TRIP_LIMIT} trips included</h2>
            </div>
            <p className="pricing-card-copy">
              For trying the full planner with trips you actually care about, not a limited demo.
            </p>
            <div className="pricing-price">
              <span className="pricing-price-amount">€0</span>
              <span className="pricing-price-period">to start</span>
            </div>
            <ul className="pricing-feature-list">
              <li><Check size={15} aria-hidden="true" /> Create complete day-by-day guides</li>
              <li><Check size={15} aria-hidden="true" /> Keep maps, stays, meals, and notes together</li>
              <li><Check size={15} aria-hidden="true" /> Share and save trips for the road</li>
            </ul>
            <Link href={startHref} className="pricing-btn-secondary">Create a free trip</Link>
          </article>

          <article className="pricing-card pricing-card-featured">
            <div className="pricing-card-ribbon">
              <TicketPercent size={14} aria-hidden="true" />
              First {EARLY_ADOPTER_LIMIT}
            </div>
            <div className="pricing-card-icon">
              <Sparkles size={18} aria-hidden="true" />
            </div>
            <div className="pricing-card-head">
              <p className="pricing-card-label">Best value</p>
              <h2>Early adopter</h2>
            </div>
            <p className="pricing-card-copy">
              A lower annual price for the first people who want OurTrips for every holiday,
              weekend away, and long route still on the wish list.
            </p>
            <div className="pricing-price">
              <span className="pricing-price-amount">{monthlyAmount(earlyPriceLabel)}</span>
              <span className="pricing-price-period">per month</span>
            </div>
            <p className="pricing-billing-note">
              {earlyBillingNote}. {EARLY_ADOPTER_ANNUAL_PRICE_LABEL} billed once per year.
            </p>
            <ul className="pricing-feature-list">
              <li><Check size={15} aria-hidden="true" /> Unlimited personal trip creation</li>
              <li><Check size={15} aria-hidden="true" /> A first-{EARLY_ADOPTER_LIMIT} founder price</li>
              <li><Check size={15} aria-hidden="true" /> Product notes and early improvements as they ship</li>
            </ul>
            <Link href={earlyHref} className="pricing-btn-primary">
              {billingEnabled ? 'Save my founder price' : 'Create a free trip'}
            </Link>
          </article>

          <article className="pricing-card">
            <div className="pricing-card-icon">
              <InfinityIcon size={18} aria-hidden="true" />
            </div>
            <div className="pricing-card-head">
              <p className="pricing-card-label">Flexible</p>
              <h2>Pro monthly</h2>
            </div>
            <p className="pricing-card-copy">
              For regular planning when you prefer a simple monthly subscription over an annual plan.
            </p>
            <div className="pricing-price">
              <span className="pricing-price-amount">{monthlyAmount(proPriceLabel)}</span>
              <span className="pricing-price-period">per month</span>
            </div>
            <ul className="pricing-feature-list">
              <li><Check size={15} aria-hidden="true" /> Unlimited personal trip creation</li>
              <li><Check size={15} aria-hidden="true" /> Editable guides, maps, sharing, and offline access</li>
              <li><Check size={15} aria-hidden="true" /> Manage billing securely through Stripe</li>
            </ul>
            <Link href="/login?next=/dashboard" className="pricing-btn-secondary">
              <CreditCard size={15} aria-hidden="true" />
              Choose monthly Pro
            </Link>
          </article>
        </section>

        <section className="pricing-note" aria-label="Billing note">
          <div>
            <p className="pricing-card-label">Gentle by design</p>
            <h2>You can decide after OurTrips has helped with actual travel.</h2>
          </div>
          <p>
            The free plan is a real starting point, not a teaser. Existing trips remain yours,
            and upgrade prompts should stay clear, calm, and tied to the moment someone wants
            to keep creating more guides.
          </p>
        </section>
      </main>

      <footer className="pricing-footer">
        <span className="pricing-footer-logo">OurTrips</span>
        <span>Built by Thijs van Schadewijk</span>
      </footer>
    </div>
  );
}
