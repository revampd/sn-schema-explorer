/**
 * E2E coverage for feature sub-flows beyond features.spec.js (#38):
 *   - Image export (PNG / SVG) + scale slider + background controls
 *   - Path Finder dot-walk output + copy buttons
 *   - Schema Diff: row → inspector, header search, clear
 *
 * Runs against the built dist/ — run `npm run build` first.
 */
import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { SCHEMA_OUTPUT } from '../fixtures/schema-output.js';
import { SCHEMA_OUTPUT_B } from '../fixtures/schema-output-b.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_URL = `file:///${join(__dirname, '../../dist/sn_schema_explorer.html').replace(/\\/g, '/')}`;

async function loadApp(page, { enableFeatures } = {}) {
  if (enableFeatures) {
    const settings = JSON.stringify(enableFeatures);
    await page.addInitScript(s => localStorage.setItem('snse:settings:v1', s), settings);
  }
  await page.goto(APP_URL);
  await page.waitForLoadState('domcontentloaded');
}

async function injectSchema(page, schema) {
  await page.locator('#file-input').setInputFiles({
    name: 'schema.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(schema)),
  });
  await page.waitForSelector('svg .node, svg g.node, svg circle', { timeout: 15_000 });
}

// ── Image export ──────────────────────────────────────────────────────────────
test.describe('Export (image)', () => {
  test('SVG export triggers a download and the scale/background controls are present', async ({
    page,
  }) => {
    await loadApp(page);
    await injectSchema(page, SCHEMA_OUTPUT);

    await page.locator('#btn-export').click();
    await expect(page.locator('#export-scale-slider')).toBeVisible();
    await expect(page.locator('#export-bg-swatch-btn')).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await page.locator('#epb-svg').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.svg$/);
  });

  test('PNG export triggers a download after adjusting the scale slider', async ({ page }) => {
    await loadApp(page);
    await injectSchema(page, SCHEMA_OUTPUT);

    await page.locator('#btn-export').click();
    // Drop the scale so the raster stays small/fast in headless.
    await page.locator('#export-scale-slider').fill('1');

    const downloadPromise = page.waitForEvent('download', { timeout: 20_000 });
    await page.locator('#epb-png').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.png$/);
  });
});

// ── Path Finder dot-walk + copy ───────────────────────────────────────────────
test.describe('Path Finder dot-walk', () => {
  test('renders the dot-walk string and copy buttons', async ({ page }) => {
    await loadApp(page, { enableFeatures: { pathFinding: true } });
    await injectSchema(page, SCHEMA_OUTPUT);

    await page.locator('#vms-path').click();
    await page.locator('#pf-source').fill('incident');
    await page.locator('#pf-target').fill('sys_user');
    await page.locator('#pf-find').click();

    // incident →(extends)→ task →(reference assigned_to)→ sys_user
    const dotwalk = page.locator('#pf-result .pf-dotwalk').first();
    await expect(dotwalk).toContainText('incident.assigned_to');

    // Dot-walk + encoded-query copy buttons both render.
    const copyBtns = page.locator('#pf-result .pf-dotwalk-copy');
    await expect(copyBtns).toHaveCount(2);
    // Clicking must not throw a page error (clipboard may be unavailable on file://).
    await copyBtns.first().click();
    await expect(copyBtns.first()).toBeVisible();
  });
});

// ── Schema Diff interactions ──────────────────────────────────────────────────
test.describe('Schema Diff interactions', () => {
  async function openDiff(page) {
    await loadApp(page, { enableFeatures: { schemaDiff: true } });
    await injectSchema(page, SCHEMA_OUTPUT);
    await page.locator('#vms-diff').click();
    await expect(page.locator('#diff-sidebar')).toBeVisible();
    await page.locator('#diff-file-input').setInputFiles({
      name: 'compare.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(SCHEMA_OUTPUT_B)),
    });
    await expect(page.locator('#diff-list .diff-item').first()).toBeVisible({ timeout: 10_000 });
  }

  test('clicking a diff row populates the inspector', async ({ page }) => {
    await openDiff(page);
    const firstItem = page.locator('#diff-list .diff-item').first();
    const id = await firstItem.getAttribute('data-id');
    await firstItem.click();
    await expect(page.locator('#inspector')).toContainText(id);
  });

  test('header search filters the diff list', async ({ page }) => {
    await openDiff(page);
    const before = await page.locator('#diff-list .diff-item').count();
    await page.locator('#diff-search-input').fill('problem');
    await page.waitForTimeout(300);
    const after = await page.locator('#diff-list .diff-item').count();
    expect(after).toBeGreaterThan(0);
    expect(after).toBeLessThanOrEqual(before);
    await expect(page.locator('#diff-list .diff-item').first()).toContainText(/problem/i);
  });

  test('clear returns to the base-only view', async ({ page }) => {
    await openDiff(page);
    await page.locator('#diff-drop-clear').click();
    // After clearing, the compare is gone — the diff list no longer shows items.
    await expect(page.locator('#diff-list .diff-item')).toHaveCount(0);
  });
});
