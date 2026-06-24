import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  billingProfileHasActiveAccess,
  isBillingFeatureEnabled,
  normalizeBillingPlan,
  type BillingProfile,
} from './billing';

const now = new Date('2026-06-23T12:00:00.000Z');

test('billing feature flag is off by default', () => {
  const previous = process.env.OURTRIPS_BILLING_ENABLED;
  delete process.env.OURTRIPS_BILLING_ENABLED;

  try {
    assert.equal(isBillingFeatureEnabled(), false);
  } finally {
    if (previous === undefined) delete process.env.OURTRIPS_BILLING_ENABLED;
    else process.env.OURTRIPS_BILLING_ENABLED = previous;
  }
});

test('billing feature flag only enables from explicit true-like values', () => {
  const previous = process.env.OURTRIPS_BILLING_ENABLED;

  try {
    process.env.OURTRIPS_BILLING_ENABLED = 'true';
    assert.equal(isBillingFeatureEnabled(), true);

    process.env.OURTRIPS_BILLING_ENABLED = 'enabled';
    assert.equal(isBillingFeatureEnabled(), true);

    process.env.OURTRIPS_BILLING_ENABLED = 'false';
    assert.equal(isBillingFeatureEnabled(), false);

    process.env.OURTRIPS_BILLING_ENABLED = 'ready-soon';
    assert.equal(isBillingFeatureEnabled(), false);
  } finally {
    if (previous === undefined) delete process.env.OURTRIPS_BILLING_ENABLED;
    else process.env.OURTRIPS_BILLING_ENABLED = previous;
  }
});

test('active subscription status grants billing access', () => {
  const profile: BillingProfile = {
    id: 'user-1',
    billing_plan: 'pro',
    billing_status: 'active',
  };

  assert.equal(billingProfileHasActiveAccess(profile, now), true);
  assert.equal(normalizeBillingPlan(profile, true), 'pro');
});

test('early adopter expiry grants access even after cancellation state', () => {
  const profile: BillingProfile = {
    id: 'user-1',
    billing_plan: 'early_adopter',
    billing_status: 'canceled',
    early_adopter_claim_number: 17,
    early_adopter_expires_at: '2029-06-23T12:00:00.000Z',
  };

  assert.equal(billingProfileHasActiveAccess(profile, now), true);
  assert.equal(normalizeBillingPlan(profile, true), 'early_adopter');
});

test('expired billing returns the free plan', () => {
  const profile: BillingProfile = {
    id: 'user-1',
    billing_plan: 'pro',
    billing_status: 'canceled',
    billing_current_period_end: '2026-01-01T00:00:00.000Z',
  };

  assert.equal(billingProfileHasActiveAccess(profile, now), false);
  assert.equal(normalizeBillingPlan(profile, false), 'free');
});

test('admin profiles can create without a Stripe subscription', () => {
  const profile: BillingProfile = {
    id: 'user-1',
    role: 'admin',
    billing_status: 'free',
  };

  assert.equal(billingProfileHasActiveAccess(profile, now), true);
  assert.equal(normalizeBillingPlan(profile, true), 'admin');
});
