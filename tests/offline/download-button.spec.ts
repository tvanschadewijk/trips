import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const SHARE_ID = process.env.TEST_SHARE_ID ?? 'NyLNFNHxC9';

test.describe('Explicit Save for offline', () => {
  async function openTripActions(page) {
    await page.getByRole('button', { name: 'Trip actions' }).click();
  }

  test('saves trip and persists manifest entry', async ({ page }) => {
    await page.goto(`${BASE}/t/${SHARE_ID}`);
    await page.waitForLoadState('networkidle');

    await openTripActions(page);
    await page.getByRole('menuitem', { name: 'Download trip for offline' }).click();
    await expect(page.getByText('Downloaded for offline')).toBeVisible();

    // Manifest entry should be present.
    const entry = await page.evaluate((shareId) => {
      const raw = localStorage.getItem('ourtrips:offline-manifest:v1');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed?.[shareId] ?? null;
    }, SHARE_ID);
    expect(entry).not.toBeNull();
    expect(entry.shareId).toBe(SHARE_ID);
  });

  test('removes a saved trip', async ({ page }) => {
    await page.goto(`${BASE}/t/${SHARE_ID}`);
    await page.waitForLoadState('networkidle');

    await openTripActions(page);
    const removeAction = page.getByRole('menuitem', { name: 'Remove offline download' });
    if (!(await removeAction.isVisible())) {
      await page.getByRole('menuitem', { name: 'Download trip for offline' }).click();
      await expect(page.getByText('Downloaded for offline')).toBeVisible();
      await openTripActions(page);
    }

    await page.getByRole('menuitem', { name: 'Remove offline download' }).click();
    await page.getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByText('Download removed')).toBeVisible();

    const entry = await page.evaluate((shareId) => {
      const raw = localStorage.getItem('ourtrips:offline-manifest:v1');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed?.[shareId] ?? null;
    }, SHARE_ID);
    expect(entry).toBeNull();
  });
});
