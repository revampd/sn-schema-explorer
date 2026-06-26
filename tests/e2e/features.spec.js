/**
 * E2E feature tests — run against the built dist/sn_schema_explorer.html file.
 * Requires: npm run build has been run before executing these tests.
 *
 * Covers feature surfaces the smoke suite doesn't:
 *   - Export bar: data exports in multiple formats trigger downloads
 *   - Path Finder: feature toggle, shortest path, and hop exclusion
 *   - Schema Diff: feature toggle, two-file compare, summary counts
 */
import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { SCHEMA_OUTPUT } from '../fixtures/schema-output.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_URL = `file:///${join(__dirname, '../../dist/sn_schema_explorer.html').replace(/\\/g, '/')}`;

// ── Helpers ───────────────────────────────────────────────────────────────────
async function loadApp(page, { enableFeatures } = {}) {
  if (enableFeatures) {
    // Pre-seed the settings cache so optional features are on before first paint.
    const settings = JSON.stringify(enableFeatures);
    await page.addInitScript(s => {
      localStorage.setItem('snse:settings:v1', s);
    }, settings);
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

// ── Export ──────────────────────────────────────────────────────────────────
test.describe('Export', () => {
  for (const { fmt, ext } of [
    { fmt: 'json', ext: /\.json$/ },
    { fmt: 'markdown', ext: /\.md$/ },
    { fmt: 'jsonld', ext: /\.jsonld$/ },
  ]) {
    test(`exports full schema as ${fmt}`, async ({ page }) => {
      await loadApp(page);
      await injectSchema(page, SCHEMA_OUTPUT);

      await page.locator('#btn-export').click();
      const fmtBtn = page.locator(`.export-fmt-btn[data-fmt="${fmt}"][data-cat="data"]`);
      await expect(fmtBtn).toBeVisible();

      const downloadPromise = page.waitForEvent('download');
      await fmtBtn.click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toMatch(ext);
    });
  }
});

// ── Path Finder ───────────────────────────────────────────────────────────────
test.describe('Path Finder', () => {
  test.use({}); // ensure each test gets its own page

  test('finds the shortest path between two tables', async ({ page }) => {
    await loadApp(page, { enableFeatures: { pathFinding: true } });
    await injectSchema(page, SCHEMA_OUTPUT);

    await page.locator('#vms-path').click();
    await expect(page.locator('#pf-sidebar')).toBeVisible();

    // incident → task (extends) → sys_user (reference)
    await page.locator('#pf-source').fill('incident');
    await page.locator('#pf-target').fill('sys_user');
    await page.locator('#pf-find').click();

    const result = page.locator('#pf-result');
    await expect(result).not.toContainText('No path found');
    await expect(result).not.toContainText('Unknown table');
    // The intermediate hop should appear in the rendered result.
    await expect(result).toContainText('task');
  });

  test('excluding the only intermediate hop removes the path', async ({ page }) => {
    await loadApp(page, { enableFeatures: { pathFinding: true } });
    await injectSchema(page, SCHEMA_OUTPUT);

    await page.locator('#vms-path').click();
    await page.locator('#pf-source').fill('incident');
    await page.locator('#pf-target').fill('sys_user');
    await page.locator('#pf-find').click();
    await expect(page.locator('#pf-result')).not.toContainText('No path found');

    // Exclude 'task' — the sole connector between incident and sys_user.
    const excl = page.locator('#pf-excluded-add');
    await excl.fill('task');
    await page.locator('#pf-excluded-ac .pf-ac-item').first().waitFor({ timeout: 5000 });
    await excl.press('ArrowDown');
    await excl.press('Enter');

    // A chip should now reflect the exclusion, and the path should disappear.
    await expect(page.locator('#pf-excluded-chips')).toContainText('task');
    await expect(page.locator('#pf-result')).toContainText('No path found');
  });
});

// ── Schema Diff ───────────────────────────────────────────────────────────────
test.describe('Schema Diff', () => {
  test('compares two schemas and reports added tables', async ({ page }) => {
    await loadApp(page, { enableFeatures: { schemaDiff: true } });
    await injectSchema(page, SCHEMA_OUTPUT);

    // Build a compare schema that adds one table relative to the base.
    const compare = JSON.parse(JSON.stringify(SCHEMA_OUTPUT));
    compare.nodes.push({
      id: 'problem',
      label: 'Problem',
      scope: 'Global',
      access: null,
      fields: [
        {
          name: 'sys_id',
          label: 'Sys ID',
          type: 'GUID',
          typeLabel: 'Sys ID (GUID)',
          mandatory: false,
          maxLength: 32,
          primary: true,
          reference: null,
        },
      ],
    });

    await page.locator('#vms-diff').click();
    await expect(page.locator('#diff-sidebar')).toBeVisible();

    await page.locator('#diff-file-input').setInputFiles({
      name: 'compare.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(compare)),
    });

    // One table added (problem); the added counter should read at least 1.
    const added = page.locator('#diff-stat-added, #diff-n-added').first();
    await expect(added).toHaveText(/[1-9]/, { timeout: 10_000 });
  });
});
