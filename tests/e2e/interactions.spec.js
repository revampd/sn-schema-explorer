/**
 * E2E tests — sidebar interaction: field search mode, hop-depth and max-nodes sliders.
 */
import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { SCHEMA_OUTPUT } from '../fixtures/schema-output.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_URL = `file:///${join(__dirname, '../../dist/sn_schema_explorer.html').replace(/\\/g, '/')}`;

async function loadAndInject(page) {
  await page.goto(APP_URL);
  await page.waitForLoadState('domcontentloaded');
  await page.locator('#file-input').setInputFiles({
    name: 'schema.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(SCHEMA_OUTPUT)),
  });
  await page.waitForSelector('#graph-root g.node-group', { timeout: 15_000 });
}

// ── Field search mode ─────────────────────────────────────────────────────────
test('switching to field search mode activates the Fld button', async ({ page }) => {
  await loadAndInject(page);
  const fldBtn = page.locator('#sms-fields');
  await fldBtn.click();
  await expect(fldBtn).toHaveClass(/active/);
  // Table search button should no longer be active
  await expect(page.locator('#sms-tables')).not.toHaveClass(/active/);
});

test('field search returns tables that contain the searched field name', async ({ page }) => {
  await loadAndInject(page);
  await page.locator('#sms-fields').click();
  // 'assigned_to' is a field on the 'task' node in our fixture
  await page.locator('#search-box').fill('assigned_to');
  await page.waitForTimeout(350); // debounce
  // The sidebar should show at least one result
  const items = page.locator('.table-item');
  await expect(items.first()).toBeVisible({ timeout: 3_000 });
});

test('clearing field search reverts to showing all tables', async ({ page }) => {
  await loadAndInject(page);
  await page.locator('#sms-fields').click();
  await page.locator('#search-box').fill('assigned_to');
  await page.waitForTimeout(350);
  await page.locator('#search-box').fill('');
  await page.waitForTimeout(350);
  // All three nodes should be back in the sidebar
  const items = page.locator('.table-item');
  await expect(items).toHaveCount(SCHEMA_OUTPUT.nodes.length, { timeout: 3_000 });
});

// ── Hop depth slider ──────────────────────────────────────────────────────────
test('changing hop-depth slider updates the displayed value', async ({ page }) => {
  await loadAndInject(page);
  const slider = page.locator('#sl-hop-depth');
  const valEl  = page.locator('#val-hop-depth');
  // Set to max (5)
  await slider.fill('5');
  await slider.dispatchEvent('input');
  await expect(valEl).toHaveText('5', { timeout: 3_000 });
});

test('reducing hop-depth to 1 shows a lower or equal node count than hop-depth 3', async ({ page }) => {
  await loadAndInject(page);
  // Select a node first to trigger hop-depth-based BFS
  await page.locator('#graph-root g.node-group').first().click();
  await page.waitForTimeout(300);

  const slider = page.locator('#sl-hop-depth');
  await slider.fill('1');
  await slider.dispatchEvent('input');
  await page.waitForTimeout(500);
  const countAt1 = parseInt(await page.locator('#stat-nodes').textContent(), 10);

  await slider.fill('3');
  await slider.dispatchEvent('input');
  await page.waitForTimeout(500);
  const countAt3 = parseInt(await page.locator('#stat-nodes').textContent(), 10);

  expect(countAt1).toBeLessThanOrEqual(countAt3);
});

// ── Max nodes slider ──────────────────────────────────────────────────────────
test('changing max-nodes slider updates the displayed value', async ({ page }) => {
  await loadAndInject(page);
  const slider = page.locator('#sl-max-nodes');
  const valEl  = page.locator('#val-max-nodes');
  await slider.fill('25');
  await slider.dispatchEvent('input');
  await expect(valEl).toHaveText('25', { timeout: 3_000 });
});
