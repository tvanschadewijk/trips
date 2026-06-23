import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const SHARE_ID = process.env.TEST_SHARE_ID ?? 'NyLNFNHxC9';

test.describe('Saved trip works offline', () => {
  test('cached HTML serves when offline', async ({ page, context }) => {
    // Warm the cache.
    await page.goto(`${BASE}/t/${SHARE_ID}`);
    await page.waitForLoadState('networkidle');

    // Go offline and reload the same URL.
    await context.setOffline(true);
    await page.reload();

    // Hero title is visible (text is application-specific; assert the
    // serif heading exists rather than a literal string).
    await expect(page.locator('h1.text-hero-title')).toBeVisible();
  });

  test('slow network falls back to cache within timeout', async ({ page, context }) => {
    await page.goto(`${BASE}/t/${SHARE_ID}`);
    await page.waitForLoadState('networkidle');

    // Throttle by routing all requests through a 6s delay.
    await context.route('**/*', async (route) => {
      await new Promise((r) => setTimeout(r, 6000));
      await route.continue();
    });

    const start = Date.now();
    await page.goto(`${BASE}/t/${SHARE_ID}`);
    const ttf = Date.now() - start;

    // SW timeout is 2.5s; expect cached HTML to win the race well under 4s.
    expect(ttf).toBeLessThan(4000);
    await expect(page.locator('h1.text-hero-title')).toBeVisible();
  });
});
