/* eslint-disable @next/next/no-img-element */

import type { Metadata } from 'next';
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
import '@/styles/pricing.css';

export const metadata: Metadata = {
  title: 'Pricing — OurTrips',
  description:
    'Start with three included trips, then choose OurTrips Pro or the first-500 early adopter annual plan.',
  alternates: {
    canonical: 'https://ourtrips.to/pricing',
  },
  openGraph: {
    title: 'Pricing — OurTrips',
    description:
      'Three trips are included. Early adopters can lock in €2,49 per month, paid annually.',
    url: 'https://ourtrips.to/pricing',
    siteName: 'OurTrips',
    locale: 'en_US',
    type: 'website',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'OurTrips trip guide preview',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Pricing — OurTrips',
    description:
      'Three trips are included. Early adopters can lock in €2,49 per month, paid annually.',
    images: ['/og-image.png'],
  },
};

function monthlyAmount(label: string): string {
  return label.replace('/month', '').trim();
}

export default function PricingPage() {
  const billingEnabled = isBillingFeatureEnabled();
  const earlyPriceLabel = process.env.OURTRIPS_EARLY_ADOPTER_PRICE_LABEL?.trim() || EARLY_ADOPTER_PRICE_LABEL;
  const earlyBillingNote = process.env.OURTRIPS_EARLY_ADOPTER_BILLING_NOTE?.trim() || EARLY_ADOPTER_BILLING_NOTE;
  const proPriceLabel = process.env.OURTRIPS_PRO_PRICE_LABEL?.trim() || PRO_PRICE_LABEL;
  const startHref = '/login?next=/dashboard%3Fagent%3Dnew';
  const earlyHref = billingEnabled ? '/login?next=/dashboard' : startHref;

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: 'OurTrips Pricing',
      url: 'https://ourtrips.to/pricing',
      description:
        'OurTrips includes three free trips, then offers Pro and first-500 early adopter subscriptions.',
    },
    {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: 'OurTrips',
      offers: [
        {
          '@type': 'Offer',
          name: 'OurTrips Early Adopter',
          price: '29.88',
          priceCurrency: 'EUR',
          availability: 'https://schema.org/LimitedAvailability',
        },
      ],
    },
  ];

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
            <h1>Make three trips first. Pay when OurTrips becomes part of how you travel.</h1>
            <p>
              Start with the full planning flow, trip guide, maps, sharing, and offline access.
              When you are ready for a fourth personal trip, choose the plan that fits.
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
              <p className="pricing-card-label">Free</p>
              <h2>{FREE_TRIP_LIMIT} trips included</h2>
            </div>
            <p className="pricing-card-copy">
              Use the complete planner for your first personal trips before choosing a subscription.
            </p>
            <div className="pricing-price">
              <span className="pricing-price-amount">€0</span>
              <span className="pricing-price-period">to begin</span>
            </div>
            <ul className="pricing-feature-list">
              <li><Check size={15} aria-hidden="true" /> AI-assisted trip creation</li>
              <li><Check size={15} aria-hidden="true" /> Day-by-day guides and maps</li>
              <li><Check size={15} aria-hidden="true" /> Sharing and offline access</li>
            </ul>
            <Link href={startHref} className="pricing-btn-secondary">Start a trip</Link>
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
              <p className="pricing-card-label">Early adopter</p>
              <h2>Founder price</h2>
            </div>
            <p className="pricing-card-copy">
              Lock in the first-500 thank-you price while helping shape the next version of OurTrips.
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
              <li><Check size={15} aria-hidden="true" /> First-500 early adopter spot</li>
              <li><Check size={15} aria-hidden="true" /> Founder updates and product notes</li>
            </ul>
            <Link href={earlyHref} className="pricing-btn-primary">
              {billingEnabled ? 'Claim early adopter' : 'Start free'}
            </Link>
          </article>

          <article className="pricing-card">
            <div className="pricing-card-icon">
              <InfinityIcon size={18} aria-hidden="true" />
            </div>
            <div className="pricing-card-head">
              <p className="pricing-card-label">Pro</p>
              <h2>Unlimited trips</h2>
            </div>
            <p className="pricing-card-copy">
              A straightforward monthly plan for regular travel planning and shared trip guides.
            </p>
            <div className="pricing-price">
              <span className="pricing-price-amount">{monthlyAmount(proPriceLabel)}</span>
              <span className="pricing-price-period">per month</span>
            </div>
            <ul className="pricing-feature-list">
              <li><Check size={15} aria-hidden="true" /> Unlimited personal trip creation</li>
              <li><Check size={15} aria-hidden="true" /> Trip guide edits and publishing</li>
              <li><Check size={15} aria-hidden="true" /> Billing controls through Stripe</li>
            </ul>
            <Link href="/login?next=/dashboard" className="pricing-btn-secondary">
              <CreditCard size={15} aria-hidden="true" />
              Choose Pro
            </Link>
          </article>
        </section>

        <section className="pricing-note" aria-label="Billing note">
          <div>
            <p className="pricing-card-label">How it works</p>
            <h2>The paywall appears at the fourth personal trip.</h2>
          </div>
          <p>
            Existing trips stay available. The early adopter offer is promoted gently in the
            dashboard, then shown clearly when someone reaches the free trip limit.
          </p>
        </section>
      </main>

      <footer className="pricing-footer">
        <span className="pricing-footer-logo">OurTrips</span>
        <span>Built by Thijs van Schadewijk</span>
      </footer>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </div>
  );
}
