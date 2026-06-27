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
import { readFileSync } from 'fs';
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
  await page.locator('[data-tool="schemaExplorer"]').click();
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

  test('edge-legend checkbox is off by default and embeds the legend when on', async ({ page }) => {
    await loadApp(page);
    await injectSchema(page, SCHEMA_OUTPUT);

    await page.locator('#btn-export').click();
    const cb = page.locator('#export-include-legend');
    await expect(cb).not.toBeChecked();

    // Baseline: legend NOT present in the export when unchecked.
    const dl1 = page.waitForEvent('download');
    await page.locator('#epb-svg').click();
    const svgOff = readFileSync(await (await dl1).path(), 'utf8');
    expect(svgOff).not.toContain('EDGE TYPES');

    // Enable the legend and re-export — the legend group should be embedded.
    await page.locator('#btn-export').click();
    await page.locator('.sn-toggle:has(#export-include-legend)').click(); // styled switch wraps the input
    await expect(cb).toBeChecked();
    const dl2 = page.waitForEvent('download');
    await page.locator('#epb-svg').click();
    const svgOn = readFileSync(await (await dl2).path(), 'utf8');
    expect(svgOn).toContain('EDGE TYPES');
    // Only the edge types actually drawn appear. By default just outgoing
    // references ("Reference to") are shown; inheritance is toggled off, so it
    // must NOT appear — proving the "only what's drawn" behaviour.
    expect(svgOn).toContain('Reference to');
    expect(svgOn).not.toContain('Inheritance');
  });
});

// ── Path Finder dot-walk + copy ───────────────────────────────────────────────
test.describe('Path Finder dot-walk', () => {
  test('renders the dot-walk string and copy buttons', async ({ page }) => {
    await loadApp(page, { enableFeatures: { pathFinding: true } });
    await injectSchema(page, SCHEMA_OUTPUT);

    await page.locator('#tool-switcher .ts-btn[data-tool="path"]').click();
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

// ── Sidebar sync across view modes (#46.14) ──────────────────────────────────
test.describe('Sidebar sync', () => {
  test('switching to Path Finder and back restores the default sidebar', async ({ page }) => {
    await loadApp(page, { enableFeatures: { pathFinding: true } });
    await injectSchema(page, SCHEMA_OUTPUT);

    // Default view: table list visible, path sidebar hidden.
    await expect(page.locator('#table-list')).toBeVisible();

    await page.locator('#tool-switcher .ts-btn[data-tool="path"]').click();
    await expect(page.locator('#pf-sidebar')).toBeVisible();
    await expect(page.locator('#table-list')).toBeHidden();

    await page.locator('#tool-switcher .ts-btn[data-tool="schema-map"]').click();
    await expect(page.locator('#pf-sidebar')).toBeHidden();
    await expect(page.locator('#table-list')).toBeVisible();
  });
});

// ── Schema Diff interactions ──────────────────────────────────────────────────
test.describe('Schema Diff interactions', () => {
  // Register a schema export as an instance from the landing page (stays on landing).
  async function registerInstance(page, schema, name) {
    await page.locator('#file-input').setInputFiles({
      name,
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(schema)),
    });
  }

  // Pick an option from a custom dropdown (core/dropdown.js) by visible label.
  async function pickDropdown(page, mountId, label) {
    await page.locator(`#${mountId} .sn-dd-btn`).click();
    // The open menu is portalled to <body> (direct child), so target it there —
    // not under the mount, where only the closed menu lives.
    await page.locator('body > .sn-dd-menu .sn-dd-opt', { hasText: label }).click();
  }

  async function openDiff(page) {
    await loadApp(page, { enableFeatures: { schemaDiff: true } });
    // #141: Diff is a layer on the Schema Map. Open the base on the map, then pick
    // the compare from the header Compare dropdown; the diff sidebar then appears.
    await registerInstance(page, SCHEMA_OUTPUT, 'base.json'); // test-instance
    await registerInstance(page, SCHEMA_OUTPUT_B, 'compare.json'); // test-instance-b
    const baseCard = page.locator('.inst-card:not(.add-card)').first();
    await baseCard.locator('[data-tool="schemaExplorer"]').click();
    await page.waitForSelector('#graph-root g.node-group', { timeout: 15_000 });
    await pickDropdown(page, 'header-compare', 'vs test-instance-b');
    await expect(page.locator('#diff-sidebar')).toBeVisible();
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
    // The header search bar (Tbl mode) filters the diff list — there is no
    // separate inline search in the diff sidebar.
    await page.locator('#search-box').fill('problem');
    await page.waitForTimeout(300);
    const after = await page.locator('#diff-list .diff-item').count();
    expect(after).toBeGreaterThan(0);
    expect(after).toBeLessThanOrEqual(before);
    await expect(page.locator('#diff-list .diff-item').first()).toContainText(/problem/i);
  });

  test('clearing the compare returns to the base-only view', async ({ page }) => {
    await openDiff(page);
    // Clearing the comparison from the header hides the diff sidebar.
    await pickDropdown(page, 'header-compare', 'Compare: none');
    await expect(page.locator('#diff-sidebar')).toBeHidden();
    // Re-selecting the same compare reproduces the diff — proving the stored
    // compare export was not mutated by the first run (clone-before-graft).
    await pickDropdown(page, 'header-compare', 'vs test-instance-b');
    await expect(page.locator('#diff-list .diff-item').first()).toBeVisible({ timeout: 10_000 });
  });

  test('swap button flips base and compare, keeping the old base as compare', async ({ page }) => {
    await openDiff(page); // base = test-instance, compare = test-instance-b (adds `problem`)
    await expect(page.locator('#diff-list .diff-item').first()).toBeVisible({ timeout: 10_000 });
    // Direction 1: `problem` exists in compare but not base → 1 added, 0 removed.
    await expect(page.locator('#diff-n-added')).toHaveText('1');
    await expect(page.locator('#diff-n-removed')).toHaveText('0');

    await page.locator('#header-swap').click();

    // The header pickers swap: Base becomes test-instance-b, Compare becomes the
    // previous base (test-instance) — not cleared.
    await expect(page.locator('#header-instance .sn-dd-label')).toHaveText('test-instance-b');
    await expect(page.locator('#header-compare .sn-dd-label')).toHaveText('vs test-instance');

    // Direction 2 must INVERT: `problem` is now in base but not compare → 1
    // removed, 0 added. (Regression: grafting polluted the outgoing base's
    // in-memory data, collapsing both counts to 0 after a swap.)
    await expect(page.locator('#diff-n-added')).toHaveText('0');
    await expect(page.locator('#diff-n-removed')).toHaveText('1');

    // The base switch runs loadGraph, which used to re-show the main sort bar
    // and Application Scopes panel in diff view — both stay hidden.
    await expect(page.locator('#sort-bar')).toBeHidden();
    await expect(page.locator('#scope-info-group')).toBeHidden();
  });
});
