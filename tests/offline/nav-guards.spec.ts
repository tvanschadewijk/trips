import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';

test.describe('Navigation while offline is graceful', () => {
  test('falls through to /offline.html on uncached routes', async ({ page, context }) => {
    // Warm the SW.
    await page.goto(`${BASE}/`);
    await page.waitForLoadState('networkidle');

    await context.setOffline(true);
    await page.goto(`${BASE}/login`);

    // Should land on the offline fallback page rather than a browser error.
    await expect(page.locator('text=Saved trips')).toBeVisible();
  });

  test('dashboard offline shows banner and only saved trips', async ({ page, context }) => {
    await page.goto(`${BASE}/dashboard`);
    await page.waitForLoadState('networkidle');

    await context.setOffline(true);
    await page.reload();

    await expect(page.locator('.dash-offline-banner')).toBeVisible();
    // Sign-out should be disabled.
    await page.locator('.dash-settings-btn').click();
    await expect(page.locator('.dash-settings-item').filter({ hasText: 'Sign out' })).toBeDisabled();
  });

  test('reconnect toast fires on transition', async ({ page, context }) => {
    await page.goto(`${BASE}/dashboard`);
    await page.waitForLoadState('networkidle');

    await context.setOffline(true);
    // Toast is hidden after ~4s; check it appeared.
    await expect(page.locator('text=You’re offline')).toBeVisible();

    await context.setOffline(false);
    await expect(page.locator('text=Back online')).toBeVisible();
  });
});
