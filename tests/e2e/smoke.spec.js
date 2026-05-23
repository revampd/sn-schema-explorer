/**
 * E2E smoke tests — run against the built dist/sn_schema_explorer.html file.
 * Requires: npm run build has been run before executing these tests.
 *
 * Tests cover the critical happy paths a user exercises on first open:
 *   1. App loads without JS errors
 *   2. Core UI structure is present
 *   3. Load overlay visible before schema is loaded
 *   4. Footer shows build version stamp
 *   5. Schema can be loaded programmatically and graph renders
 *   6. Search filters the sidebar
 */
import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { SCHEMA_OUTPUT } from '../fixtures/schema-output.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_URL = `file:///${join(__dirname, '../../dist/sn_schema_explorer.html').replace(/\\/g, '/')}`;

// ── Helpers ───────────────────────────────────────────────────────────────────
async function loadApp(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(APP_URL);
  await page.waitForLoadState('domcontentloaded');
  return errors;
}

async function injectSchema(page, schema) {
  // Upload the fixture JSON via the hidden file input — this triggers the same
  // processing pipeline as a user dropping a file on the drop zone.
  await page.locator('#file-input').setInputFiles({
    name:     'schema.json',
    mimeType: 'application/json',
    buffer:   Buffer.from(JSON.stringify(schema)),
  });
  // Wait for the SVG graph to contain at least one rendered node
  await page.waitForSelector('svg .node, svg g.node, svg circle', { timeout: 15_000 });
}

// ── Tests ─────────────────────────────────────────────────────────────────────
test('app loads without JavaScript errors', async ({ page }) => {
  const errors = await loadApp(page);
  expect(errors).toHaveLength(0);
});

test('core UI structure is present on load', async ({ page }) => {
  await loadApp(page);
  await expect(page.locator('header')).toBeVisible();
  await expect(page.locator('#search-box')).toBeVisible();
  await expect(page.locator('#canvas')).toBeVisible();
  await expect(page.locator('#inspector')).toBeVisible();
  await expect(page.locator('footer')).toBeVisible();
});

test('load overlay is visible before a schema is loaded', async ({ page }) => {
  await loadApp(page);
  // The load overlay should be visible on first open
  const overlay = page.locator('#load-overlay, .load-overlay, #drop-zone');
  await expect(overlay.first()).toBeVisible();
});

test('footer shows build version stamp', async ({ page }) => {
  await loadApp(page);
  const footer = page.locator('footer');
  // Version stamp format: 1.0.0-YYYYMMDD-HHmm
  await expect(footer).toContainText(/\d+\.\d+\.\d+-\d{8}-\d{4}/);
});

test('schema loads and graph renders nodes', async ({ page }) => {
  await loadApp(page);
  await injectSchema(page, SCHEMA_OUTPUT);
  // Stat counter must show the correct node count from the fixture (3 nodes)
  const statNodes = page.locator('#stat-nodes');
  await expect(statNodes).not.toHaveText('0');
  const count = parseInt(await statNodes.textContent(), 10);
  expect(count).toBe(SCHEMA_OUTPUT.nodes.length);
});

test('search box filters sidebar table list', async ({ page }) => {
  await loadApp(page);
  await injectSchema(page, SCHEMA_OUTPUT);
  const searchBox = page.locator('#search-box');
  await searchBox.fill('incident');
  // After searching, at least one result should be visible
  await page.waitForTimeout(300); // debounce
  const items = page.locator('.table-item, .sidebar-row, [data-id="incident"]');
  await expect(items.first()).toBeVisible();
});
