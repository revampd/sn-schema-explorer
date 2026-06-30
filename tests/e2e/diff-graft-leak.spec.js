/**
 * Regression: the Schema Diff graft must NOT leak into the Schema Map.
 *
 * Diff grafts the compare's added (`_diffOnly`) tables into the shared base graph
 * so they render in diff view. Switching back to the Schema Map must un-graft
 * them — otherwise a table that only exists in the compare instance "merges" into
 * the base and shows up in the map and its search.
 *
 * Runs against the built dist/ — run `npm run build` first.
 */
import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_URL = `file:///${join(__dirname, '../../dist/sn_schema_explorer.html').replace(/\\/g, '/')}`;

// Base has 2 tables; compare adds a third (`xyz`).
const base = {
  _instance: { instance_name: 'dev' },
  nodes: [
    { id: 'task', label: 'Task', scope: 'Global', fields: [] },
    { id: 'incident', label: 'Incident', scope: 'Global', fields: [] },
  ],
  edges: [{ source: 'incident', target: 'task', type: 'extends' }],
};
const compare = {
  _instance: { instance_name: 'prod' },
  nodes: [
    { id: 'task', label: 'Task', scope: 'Global', fields: [] },
    { id: 'incident', label: 'Incident', scope: 'Global', fields: [] },
    { id: 'xyz', label: 'Xyz', scope: 'Global', fields: [] },
  ],
  edges: [
    { source: 'incident', target: 'task', type: 'extends' },
    { source: 'xyz', target: 'task', type: 'reference', field: 'rel' },
  ],
};

async function register(page, data, fileName) {
  await page.locator('#file-input').setInputFiles({
    name: fileName,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(data)),
  });
}

test('compare-only table does not leak into the Schema Map after diffing', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('snse:settings:v1', JSON.stringify({ schemaDiff: true }))
  );
  await page.goto(APP_URL);
  await page.waitForLoadState('domcontentloaded');
  await register(page, base, 'base.json'); // dev
  await register(page, compare, 'compare.json'); // prod

  // Schema Map on the base: only its 2 tables, no `xyz`.
  await page
    .locator('.inst-card:not(.add-card)')
    .first()
    .locator('[data-tool="schemaExplorer"]')
    .click();
  await page.waitForSelector('#graph-root g.node-group', { timeout: 15_000 });
  await expect(page.locator('#table-list-viewport .table-item[data-id="xyz"]')).toHaveCount(0);

  // Start a comparison from the header → `xyz` is grafted in as an added table.
  await page.locator('#header-compare .sn-dd-btn').click();
  await page.locator('body > .sn-dd-menu .sn-dd-opt', { hasText: 'vs prod' }).click();
  await expect(page.locator('#diff-list .diff-item', { hasText: 'Xyz' })).toBeVisible({
    timeout: 10_000,
  });

  // Clear the comparison → `xyz` must be un-grafted, gone from the map table list.
  await page.locator('#header-compare .sn-dd-btn').click();
  await page.locator('body > .sn-dd-menu .sn-dd-opt', { hasText: 'Compare: none' }).click();
  await expect(page.locator('#diff-sidebar')).toBeHidden();
  await expect(page.locator('#table-list-viewport .table-item[data-id="xyz"]')).toHaveCount(0);

  // And re-comparing re-grafts it.
  await page.locator('#header-compare .sn-dd-btn').click();
  await page.locator('body > .sn-dd-menu .sn-dd-opt', { hasText: 'vs prod' }).click();
  await expect(page.locator('#diff-list .diff-item', { hasText: 'Xyz' })).toBeVisible();
});
