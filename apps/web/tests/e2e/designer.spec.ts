// eslint-disable-next-line import/no-unresolved
import { test, expect } from '@playwright/test';

/**
 * Auth stub: intercept /api/users/me so the router guard allows /designer/new.
 * All three tests below call this at the start.
 *
 * NOTE: route handlers in Playwright persist across navigations on the same
 * page object, so a single stubAuth call before goto is sufficient.
 */
async function stubAuth(page: import('@playwright/test').Page): Promise<void> {
  await page.route('**/users/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        user: {
          id: 'test-user',
          name: 'Test User',
          email: 'test@example.com',
          avatarUrl: null,
          role: 'admin',
          mustChangePassword: false,
          csrf: 'test-csrf-token',
        },
      }),
    }),
  );
  // Stub /auth/refresh so any retry path doesn't block
  await page.route('**/auth/refresh', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, csrf: 'test-csrf-token' }),
    }),
  );
}

/**
 * Navigate to /designer/new with auth stubbed and localStorage cleared.
 * Returns after .tp-top-toolbar is visible.
 */
async function openDesigner(page: import('@playwright/test').Page): Promise<void> {
  await stubAuth(page);
  // Clear any stale draft in localStorage before the app boots
  await page.addInitScript(() => {
    localStorage.removeItem('tp_designer_draft');
  });
  await page.goto('/designer/new');
  await page.waitForSelector('.tp-top-toolbar', { timeout: 15_000 });
}

// ---------------------------------------------------------------------------
// Test 1: Cell change preserves visual position via anchor
// ---------------------------------------------------------------------------

test('iteration 2 — cell change preserves visual position via anchor', async ({ page }) => {
  await openDesigner(page);

  // Add a text element via the library
  // The button has a glyph span + a label span; use CSS :has to target by label text.
  await page.locator('.lib-btn', { hasText: '文字' }).first().click();
  const el = page.locator('.tp-element').first();
  await el.waitFor({ state: 'visible' });
  const beforeBox = await el.boundingBox();
  expect(beforeBox).toBeTruthy();

  // Change cell size via the ⊞ toolbar dropdown
  await page.getByRole('button', { name: /^⊞/ }).click();

  // Element Plus teleports dropdown menus to body; wait for a visible popup item.
  // The items for this dropdown appear in a popper; all el-dropdown-menu__item elements
  // that are inside a visible dropdown menu will be in .el-dropdown-menu:visible.
  const cellDropdown = page.locator(
    '.el-popper:not([style*="display: none"]) .el-dropdown-menu__item',
  );
  await cellDropdown.first().waitFor({ state: 'visible', timeout: 8_000 });
  const count = await cellDropdown.count();
  // Click the second item to choose a different cell size
  if (count >= 2) await cellDropdown.nth(1).click();
  else await cellDropdown.first().click();

  // Element should remain at roughly the same visual px position (within 20 px drift)
  const afterBox = await el.boundingBox();
  expect(Math.abs((afterBox?.x ?? 0) - (beforeBox!.x ?? 0))).toBeLessThan(20);
  expect(Math.abs((afterBox?.y ?? 0) - (beforeBox!.y ?? 0))).toBeLessThan(20);
});

// ---------------------------------------------------------------------------
// Test 2: QR resize locks 1:1
// ---------------------------------------------------------------------------

test('iteration 2 — QR resize locks 1:1', async ({ page }) => {
  await openDesigner(page);

  // Add a QR element via the library (button label '二维码')
  // The .lib-btn has a glyph span + a label span — use hasText to find by label.
  await page.locator('.lib-btn', { hasText: '二维码' }).first().click();
  const el = page.locator('.tp-element').first();
  await el.waitFor({ state: 'visible' });
  // Use dispatchEvent to select the element (avoids sidebar pointer intercept).
  await el.dispatchEvent('click');

  // The SE corner HitZone (.hit.se) handles resize; .tp-handle-br is cosmetic (pointer-events: none).
  const handle = el.locator('.hit.se');
  await handle.waitFor({ state: 'visible' });
  const handleBox = await handle.boundingBox();
  expect(handleBox).toBeTruthy();

  // Drag only horizontally — QR lock should force both axes to match
  await page.mouse.move(handleBox!.x + 4, handleBox!.y + 4);
  await page.mouse.down();
  // Drag 60px on X, 4px on Y — the QR 1:1 lock uses the larger axis
  await page.mouse.move(handleBox!.x + 64, handleBox!.y + 8, { steps: 10 });
  await page.mouse.up();

  // Size badge should show square dims AND the (1:1) suffix
  const badge = el.locator('.tp-size-badge');
  await badge.waitFor({ state: 'visible' });
  const badgeText = await badge.textContent();
  // Pattern: "NN×NN 格 (1:1)" where both numbers are equal
  expect(badgeText).toMatch(/(\d+)×\1 格 \(1:1\)/);
});

// ---------------------------------------------------------------------------
// Test 3: Paper dropdown lists 11 presets + custom
// ---------------------------------------------------------------------------

test('iteration 2 — paper dropdown lists 11 presets + custom', async ({ page }) => {
  await openDesigner(page);

  // Open the paper dropdown (button starts with 📄)
  await page.getByRole('button', { name: /📄/ }).click();

  // Collect all dropdown items
  const items = page.locator('.el-dropdown-menu__item');
  await items.first().waitFor({ state: 'visible' });
  const labels = await items.allTextContents();

  // Verify expected presets and custom option are present
  expect(labels.some((l) => l.includes('A3'))).toBe(true);
  expect(labels.some((l) => l.includes('Letter'))).toBe(true);
  expect(labels.some((l) => l.includes('出门证'))).toBe(true);
  expect(labels.some((l) => l.includes('物流面单'))).toBe(true);
  expect(labels.some((l) => l.includes('自定义'))).toBe(true);

  // Verify total item count: 11 presets + 1 custom = 12
  expect(labels.length).toBeGreaterThanOrEqual(12);
});
