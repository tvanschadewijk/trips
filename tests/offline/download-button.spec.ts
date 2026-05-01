import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const SHARE_ID = process.env.TEST_SHARE_ID ?? 'demo';

test.describe('Explicit Save for offline', () => {
  test('saves trip and persists manifest entry', async ({ page }) => {
    await page.goto(`${BASE}/t/${SHARE_ID}`);
    await page.waitForLoadState('networkidle');

    // Tap a non-cover slide so the save button (which lives in the nav
    // when not 'over-hero') has full contrast and is hit-testable. The
    // button is also visible on the cover; this just exercises both.
    const saveBtn = page.locator('.save-offline-btn');
    await saveBtn.click();

    // Wait for the saved (terracotta check) state.
    await expect(saveBtn).toHaveClass(/saved/);

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

    const saveBtn = page.locator('.save-offline-btn');
    if (!(await saveBtn.evaluate((el) => el.classList.contains('saved')))) {
      await saveBtn.click();
      await expect(saveBtn).toHaveClass(/saved/);
    }

    // Tap the saved button to open the confirm dialog.
    await saveBtn.click();
    await page.locator('.confirm-btn-delete').click();

    await expect(saveBtn).not.toHaveClass(/saved/);

    const entry = await page.evaluate((shareId) => {
      const raw = localStorage.getItem('ourtrips:offline-manifest:v1');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed?.[shareId] ?? null;
    }, SHARE_ID);
    expect(entry).toBeNull();
  });
});
