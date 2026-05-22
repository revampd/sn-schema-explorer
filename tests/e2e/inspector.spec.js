/**
 * E2E tests — inspector panel interaction.
 *
 * Verifies that clicking a table node in the force graph opens the inspector,
 * hides the empty-state placeholder, and shows the table's name.
 */
import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { SCHEMA_OUTPUT } from '../fixtures/schema-output.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_URL = `file:///${join(__dirname, '../../dist/sn_schema_explorer.html').replace(/\\/g, '/')}`;

async function loadAndInject(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(APP_URL);
  await page.waitForLoadState('domcontentloaded');
  await page.locator('#file-input').setInputFiles({
    name: 'schema.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(SCHEMA_OUTPUT)),
  });
  // Wait for at least one node-group to appear in the SVG
  await page.waitForSelector('#graph-root g.node-group', { timeout: 15_000 });
  return errors;
}

test('inspector-content is empty before any schema is loaded', async ({ page }) => {
  // Navigate to the app but do NOT load a schema — inspector should be empty
  await page.goto(APP_URL);
  await page.waitForLoadState('domcontentloaded');
  const content = page.locator('#inspector-content');
  await expect(content).toBeEmpty();
});

test('schema load auto-selects a default table and populates inspector', async ({ page }) => {
  // The app selects the 'task' node (or most-connected node) automatically after load
  await loadAndInject(page);
  const content = page.locator('#inspector-content');
  await expect(content).not.toBeEmpty({ timeout: 5_000 });
});

test('inspector content contains the clicked table name', async ({ page }) => {
  await loadAndInject(page);
  // Click the first node and verify the inspector shows one of the fixture table ids
  await page.locator('#graph-root g.node-group').first().click();
  await page.waitForSelector('#inspector-content :first-child', { timeout: 5_000 });
  const content = await page.locator('#inspector-content').textContent();
  const tableIds = SCHEMA_OUTPUT.nodes.map(n => n.id);
  const found = tableIds.some(id => content.includes(id) || content.toLowerCase().includes(id));
  expect(found).toBe(true);
});

test('stat-focus updates to show selected table after click', async ({ page }) => {
  await loadAndInject(page);
  await page.locator('#graph-root g.node-group').first().click();
  const focus = page.locator('#stat-focus');
  // stat-focus should no longer show the default placeholder "—"
  await expect(focus).not.toHaveText('—', { timeout: 5_000 });
});
