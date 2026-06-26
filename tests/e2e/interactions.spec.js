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
    name: 'schema.json',
    mimeType: 'application/json',
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
  const valEl = page.locator('#val-hop-depth');
  // The slider max is computed dynamically from the selected node's reachable
  // neighbourhood — use evaluate() to read it and set a valid value, the same
  // pattern used for max-nodes (never hard-code a value that may exceed the cap).
  const newVal = await page.evaluate(() => {
    const el = document.getElementById('sl-hop-depth');
    const v = String(el.max || '1');
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return v;
  });
  await expect(valEl).toHaveText(newVal, { timeout: 3_000 });
});

test('reducing hop-depth to 1 shows a lower or equal node count than hop-depth max', async ({
  page,
}) => {
  await loadAndInject(page);
  // Select a node first to trigger hop-depth-based BFS
  await page.locator('#graph-root g.node-group').first().click();
  await page.waitForTimeout(300);

  // Set to depth 1 and record visible node count
  await page.evaluate(() => {
    const el = document.getElementById('sl-hop-depth');
    el.value = '1';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(500);
  const countAt1 = parseInt(await page.locator('#stat-nodes').textContent(), 10);

  // Set to the slider's actual maximum and record visible node count.
  // With the small test fixture the max may also be 1 — in that case both
  // counts are equal, which still satisfies the ≤ assertion.
  await page.evaluate(() => {
    const el = document.getElementById('sl-hop-depth');
    el.value = el.max;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(500);
  const countAtMax = parseInt(await page.locator('#stat-nodes').textContent(), 10);

  expect(countAt1).toBeLessThanOrEqual(countAtMax);
});

// ── Max nodes slider ──────────────────────────────────────────────────────────
test('changing max-nodes slider updates the displayed value', async ({ page }) => {
  await loadAndInject(page);
  // The slider max is dynamically clamped to the node count after load,
  // so we use evaluate() to pick a valid value rather than hard-coding one.
  const newVal = await page.evaluate(() => {
    const el = document.getElementById('sl-max-nodes');
    const v = String(Math.max(1, parseInt(el.max, 10) - 1 || 1));
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return v;
  });
  await expect(page.locator('#val-max-nodes')).toHaveText(newVal, { timeout: 3_000 });
});
