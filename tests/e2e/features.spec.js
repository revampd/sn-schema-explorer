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
  await page.locator('[data-tool="schemaExplorer"]').click();
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

    await page.locator('#tool-switcher .ts-btn[data-tool="path"]').click();
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

  test('hop exclusions render before the find button', async ({ page }) => {
    await loadApp(page, { enableFeatures: { pathFinding: true } });
    await injectSchema(page, SCHEMA_OUTPUT);

    await page.locator('#tool-switcher .ts-btn[data-tool="path"]').click();
    await expect(page.locator('#pf-sidebar')).toBeVisible();

    // Hop exclusions section should precede the Find button in DOM order
    // (Node.DOCUMENT_POSITION_FOLLOWING === 4).
    const order = await page.evaluate(() => {
      const excl = document.getElementById('pf-excluded-section');
      const find = document.getElementById('pf-find');
      return excl.compareDocumentPosition(find) & Node.DOCUMENT_POSITION_FOLLOWING;
    });
    expect(order).toBeTruthy();
  });

  test('excluding the only intermediate hop removes the path', async ({ page }) => {
    await loadApp(page, { enableFeatures: { pathFinding: true } });
    await injectSchema(page, SCHEMA_OUTPUT);

    await page.locator('#tool-switcher .ts-btn[data-tool="path"]').click();
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
  test('compares two registered instances and reports added tables', async ({ page }) => {
    await loadApp(page, { enableFeatures: { schemaDiff: true } });

    // Base instance.
    await page.locator('#file-input').setInputFiles({
      name: 'base.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(SCHEMA_OUTPUT)),
    });

    // Compare instance — adds one table (problem) relative to the base.
    const compare = JSON.parse(JSON.stringify(SCHEMA_OUTPUT));
    compare._instance = { ...(compare._instance || {}), instance_name: 'compare-inst' };
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
    await page.locator('#file-input').setInputFiles({
      name: 'compare.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(compare)),
    });

    // #141: open the base on the Schema Map, then pick the compare from the header
    // Compare dropdown — the diff layer + sidebar appear.
    const baseCard = page.locator('.inst-card:not(.add-card)').first();
    await baseCard.locator('[data-tool="schemaExplorer"]').click();
    await page.waitForSelector('#graph-root g.node-group', { timeout: 15_000 });
    await page.locator('#header-compare .sn-dd-btn').click();
    await page.locator('body > .sn-dd-menu .sn-dd-opt', { hasText: 'compare-inst' }).click();
    await expect(page.locator('#diff-sidebar')).toBeVisible();

    // One table added (problem); the added counter should read at least 1.
    const added = page.locator('#diff-stat-added, #diff-n-added').first();
    await expect(added).toHaveText(/[1-9]/, { timeout: 10_000 });

    // Selecting a compare auto-enables the Differences overlay on the canvas
    // (the user shouldn't have to click Differences to see the diff), and the
    // toggle still mutes it on demand.
    const diffToggle = page.locator('#diff-layer-master');
    await expect(diffToggle).toBeVisible();
    await expect(diffToggle).toHaveAttribute('aria-pressed', 'true');

    // A new comparison shows the FULL graph with diff colouring (not collapsed to
    // changed-only) — so the graph toggle starts in its "all tables" state.
    await expect(page.locator('#diff-show-all-btn')).toHaveText('Graph: all tables');
    await diffToggle.click();
    await expect(diffToggle).toHaveAttribute('aria-pressed', 'false');
  });

  test('exports the active comparison — embedded toggle + standalone scope (#177)', async ({
    page,
  }) => {
    await loadApp(page, { enableFeatures: { schemaDiff: true } });
    await page.locator('#file-input').setInputFiles({
      name: 'base.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(SCHEMA_OUTPUT)),
    });
    const compare = JSON.parse(JSON.stringify(SCHEMA_OUTPUT));
    compare._instance = { ...(compare._instance || {}), instance_name: 'compare-inst' };
    compare.nodes.push({
      id: 'problem',
      label: 'Problem',
      fields: [{ name: 'sys_id', type: 'GUID' }],
    });
    await page.locator('#file-input').setInputFiles({
      name: 'compare.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(compare)),
    });
    await page
      .locator('.inst-card:not(.add-card)')
      .first()
      .locator('[data-tool="schemaExplorer"]')
      .click();
    await page.waitForSelector('#graph-root g.node-group', { timeout: 15_000 });
    await page.locator('#header-compare .sn-dd-btn').click();
    await page.locator('body > .sn-dd-menu .sn-dd-opt', { hasText: 'compare-inst' }).click();
    await expect(page.locator('#diff-sidebar')).toBeVisible();

    // The comparison affordances appear in the export bar only while comparing.
    await page.locator('#btn-export').click();
    await expect(page.locator('#export-bar.open')).toBeVisible();
    await expect(page.locator('#export-data-scope-cmp')).toBeVisible();
    await expect(page.locator('#export-comparison-controls')).toBeVisible();
    await expect(page.locator('.export-compare-chip')).toHaveCount(1);

    // Embedded: tick "Include comparison" and export Full-schema JSON → carries a
    // `comparison` block with the added table.
    await page.locator('#export-include-comparison').check({ force: true });
    const dl1 = page.waitForEvent('download');
    await page.locator('#epb-json').click();
    const embedded = await dl1;
    const embPath = await embedded.path();
    const { readFileSync } = await import('fs');
    const embJson = JSON.parse(readFileSync(embPath, 'utf8'));
    expect(embJson.nodes.length).toBeGreaterThan(0); // still a full schema
    expect(embJson.comparison).toBeTruthy();
    expect(embJson.comparison.tables.some(t => t.id === 'problem')).toBe(true);

    // Standalone: the Comparison scope emits ONLY the diff.
    await page.locator('#btn-export').click();
    await page.locator('#export-data-scope-cmp').click();
    const dl2 = page.waitForEvent('download');
    await page.locator('#epb-json').click();
    const standalone = await dl2;
    expect(standalone.suggestedFilename()).toMatch(/sn_comparison_.*\.json$/);
    const stPath = await standalone.path();
    const stJson = JSON.parse(readFileSync(stPath, 'utf8'));
    expect(stJson.nodes).toBeUndefined(); // no schema dump
    expect(stJson.tables.some(t => t.id === 'problem')).toBe(true);
  });

  test('image export carries the diff colours + a diff legend (#177)', async ({ page }) => {
    await loadApp(page, { enableFeatures: { schemaDiff: true } });
    await page.locator('#file-input').setInputFiles({
      name: 'base.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(SCHEMA_OUTPUT)),
    });
    const compare = JSON.parse(JSON.stringify(SCHEMA_OUTPUT));
    compare._instance = { ...(compare._instance || {}), instance_name: 'compare-inst' };
    compare.nodes.push({
      id: 'problem',
      label: 'Problem',
      fields: [{ name: 'sys_id', type: 'GUID' }],
    });
    await page.locator('#file-input').setInputFiles({
      name: 'compare.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(compare)),
    });
    await page
      .locator('.inst-card:not(.add-card)')
      .first()
      .locator('[data-tool="schemaExplorer"]')
      .click();
    await page.waitForSelector('#graph-root g.node-group', { timeout: 15_000 });
    await page.locator('#header-compare .sn-dd-btn').click();
    await page.locator('body > .sn-dd-menu .sn-dd-opt', { hasText: 'compare-inst' }).click();
    await expect(page.locator('#diff-sidebar')).toBeVisible();

    // Enable the (renamed) Legend toggle and export SVG → the diff legend group
    // is drawn into the image.
    await page.locator('#btn-export').click();
    await expect(page.locator('#export-bar.open')).toBeVisible();
    await page.locator('#export-include-legend').check({ force: true });
    const dl = page.waitForEvent('download');
    await page.locator('#epb-svg').click();
    const { readFileSync } = await import('fs');
    const svg = readFileSync(await (await dl).path(), 'utf8');
    expect(svg).toContain('DIFFERENCES'); // the diff legend header
    expect(svg).toContain('>Added<'); // an added table exists (problem)
  });

  test('report groups collapse on header click', async ({ page }) => {
    await loadApp(page, { enableFeatures: { schemaDiff: true } });
    const base = JSON.parse(JSON.stringify(SCHEMA_OUTPUT));
    const compare = JSON.parse(JSON.stringify(SCHEMA_OUTPUT));
    compare._instance = { ...(compare._instance || {}), instance_name: 'compare-inst' };
    compare.nodes.push({
      id: 'problem',
      label: 'Problem',
      fields: [{ name: 'sys_id', label: 'Sys ID', type: 'GUID' }],
    });
    await page.locator('#file-input').setInputFiles({
      name: 'base.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(base)),
    });
    await page.locator('#file-input').setInputFiles({
      name: 'compare.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(compare)),
    });
    await page
      .locator('.inst-card:not(.add-card)')
      .first()
      .locator('[data-tool="schemaExplorer"]')
      .click();
    await page.waitForSelector('#graph-root g.node-group', { timeout: 15_000 });
    await page.locator('#header-compare .sn-dd-btn').click();
    await page.locator('body > .sn-dd-menu .sn-dd-opt', { hasText: 'compare-inst' }).click();
    await expect(page.locator('#diff-sidebar')).toBeVisible();

    // The "Added" group (problem) collapses on header click; config rows never
    // appear in the report (config drift lives in the Inspector now).
    const addedGroup = page.locator('.diff-group[data-group="added"]');
    await expect(addedGroup).toBeVisible();
    await expect(addedGroup.locator('.diff-group-body')).toBeVisible();
    await page.locator('.diff-group-header[data-group="added"]').click();
    await expect(addedGroup).toHaveClass(/collapsed/);
    await expect(addedGroup.locator('.diff-group-body')).toBeHidden();
    await expect(page.locator('.diff-group[data-group="config"]')).toHaveCount(0);
    await expect(page.locator('#diff-type-table, #diff-type-app')).toHaveCount(0);
  });
});

// ── Configuration Data ─────────────────────────────────────────────────────
test.describe('Configuration Data', () => {
  // A schema export carrying a plugins metadata section.
  const withPlugins = (name, xVersion) => ({
    _instance: { instance_name: name },
    nodes: [{ id: 'task' }],
    edges: [],
    _metadata: {
      plugins: [
        { id: 'com.x', name: 'X Plugin', active: true, version: xVersion },
        { id: 'com.y', name: 'Y Plugin', active: true, version: '2.0' },
      ],
    },
  });

  async function register(page, schema, fileName) {
    await page.locator('#file-input').setInputFiles({
      name: fileName,
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(schema)),
    });
  }

  test('compares a metadata section across instances and exports CSV', async ({
    page,
  }, testInfo) => {
    await loadApp(page, { enableFeatures: { configData: true } });
    await register(page, withPlugins('dev', '1.0'), 'dev.json');
    await register(page, withPlugins('prod', '1.1'), 'prod.json');

    // Launch the comparison from an instance card.
    const card = page.locator('.inst-card:not(.add-card)').first();
    await card.locator('[data-tool="configData"]').click();
    await expect(page.locator('#config-data')).toBeVisible();

    // The compare selection defaults to none (just the base column); add the other
    // instance via the header Compare control to get a comparison.
    await page.locator('#header-compare .sn-dd-btn').click();
    await page.locator('.sn-dd-menu:visible .sn-dd-opt', { hasText: 'vs ' }).first().click();

    // Plugins tab active by default; the table shows a column per instance.
    await expect(page.locator('.cd-tab.active')).toContainText('Plugins');
    await expect(page.locator('.cd-table tbody tr')).toHaveCount(2); // com.x, com.y
    // com.x drifts (1.0 vs 1.1) → at least one Drift chip.
    await expect(page.locator('.cd-table .pill-badge', { hasText: 'Drift' }).first()).toBeVisible();

    // Export CSV/JSON now live in the header Export bar (view-aware). Open it.
    await page.locator('#btn-export').click();
    await expect(page.locator('#export-bar.open')).toBeVisible();
    // Only the Config Data row is shown on this workspace.
    await expect(page.locator('.export-row--config')).toBeVisible();
    await expect(page.locator('.export-row--data')).toBeHidden();
    await expect(page.locator('.export-row--image')).toBeHidden();

    // Export CSV triggers a download.
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#epb-cd-csv').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/plugins_configuration\.csv$/);

    // Export JSON triggers a download too.
    await page.locator('#btn-export').click();
    const jsonDownloadPromise = page.waitForEvent('download');
    await page.locator('#epb-cd-json').click();
    const jsonDownload = await jsonDownloadPromise;
    expect(jsonDownload.suggestedFilename()).toMatch(/plugins_configuration\.json$/);
    void testInfo;
  });

  // A schema export carrying instance metadata + stats for the Instance Data tab.
  const withStats = (name, tables) => ({
    _instance: {
      instance_name: name,
      build_name: 'Washington',
      exported_at: '2026-06-27 11:05:53',
    },
    _stats: { counts: { tables, fields: tables * 20, references: tables }, coverage: {} },
    _schema_version: 1,
    nodes: [{ id: 'task' }],
    edges: [],
    _metadata: { plugins: [{ id: 'com.x', name: 'X', active: true, version: '1.0' }] },
  });

  test('Instance Data tab shows per-instance sections and an N-column stats table', async ({
    page,
  }) => {
    await loadApp(page, { enableFeatures: { configData: true } });
    await register(page, withStats('dev', 9356), 'dev.json');
    await register(page, withStats('prod', 20), 'prod.json');

    await page
      .locator('.inst-card:not(.add-card)')
      .first()
      .locator('[data-tool="configData"]')
      .click();
    await expect(page.locator('#config-data')).toBeVisible();

    // Compare defaults to none; add the other instance so the comparison spans two.
    await page.locator('#header-compare .sn-dd-btn').click();
    await page.locator('.sn-dd-menu:visible .sn-dd-opt', { hasText: 'vs ' }).first().click();

    // Switch to the Instance Data tab.
    await page.locator('.cd-tab[data-section="__instance__"]').click();
    await expect(page.locator('.cd-tab.active')).toContainText('Instance Data');

    const panel = page.locator('#cd-instance');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('Identity');
    await expect(panel).toContainText('Schema stats');
    await expect(panel.locator('.insti-compare')).toBeVisible();
    // A stat delta is rendered between the instances (direction depends on which
    // instance is the base — i.e. the one Config Data was opened from).
    await expect(panel.locator('.isd-down, .isd-up').first()).toBeVisible();
    // Metadata-comparison controls are hidden in this mode.
    await expect(page.locator('#config-data .cd-controls')).toBeHidden();
    // One aligned table: a header column per instance (blank label col + 2).
    await expect(panel.locator('.insti-compare thead th')).toHaveCount(3);
  });

  test('header Compare control sets the comparison columns', async ({ page }) => {
    await loadApp(page, { enableFeatures: { configData: true } });
    await register(page, withStats('dev', 9356), 'dev.json');
    await register(page, withStats('prod', 20), 'prod.json');
    await register(page, withStats('qa', 100), 'qa.json');

    await page
      .locator('.inst-card:not(.add-card)')
      .first()
      .locator('[data-tool="configData"]')
      .click();
    await page.locator('.cd-tab[data-section="__instance__"]').click();

    const panel = page.locator('#cd-instance');
    // The in-workspace chip picker is gone — selection lives in the header now,
    // and the compare defaults to none → just the base column (blank + 1 = 2).
    await expect(page.locator('#cd-instances')).toHaveCount(0);
    await expect(page.locator('#header-instance')).toBeVisible();
    await expect(page.locator('#header-compare')).toBeVisible();
    await expect(panel.locator('.insti-compare thead th')).toHaveCount(2);

    // Adding one compare from the header widens the comparison to two instances.
    await page.locator('#header-compare .sn-dd-btn').click();
    await page.locator('.sn-dd-menu:visible .sn-dd-opt', { hasText: 'vs ' }).first().click();
    await expect(panel.locator('.insti-compare thead th')).toHaveCount(3);
  });

  test('compare selection in Config carries to the Schema Map diff', async ({ page }) => {
    await loadApp(page, { enableFeatures: { configData: true, schemaDiff: true } });
    const mk = (n, ver) => ({
      _instance: { instance_name: n },
      nodes: [
        {
          id: 'incident',
          label: 'Incident',
          fields: [{ name: 'number', label: 'Number', type: 'string' }],
        },
      ],
      edges: [],
      _metadata: { plugins: [{ id: 'com.a', name: 'A', active: true, version: ver }] },
    });
    await register(page, mk('dev', '1.0'), 'dev.json');
    await register(page, mk('prod', '1.1'), 'prod.json');

    await page
      .locator('.inst-card:not(.add-card)')
      .first()
      .locator('[data-tool="configData"]')
      .click();
    await expect(page.locator('#config-data')).toBeVisible();
    // Default none; pick a compare in Config.
    await page.locator('#header-compare .sn-dd-btn').click();
    await page.locator('.sn-dd-menu:visible .sn-dd-opt', { hasText: 'vs ' }).first().click();
    const cfgLabel = await page.locator('#header-compare .sn-dd-label').textContent();

    // Switch to the Schema Map via the header switcher — the graph loads and the
    // comparison materialises as the diff (synced selection).
    await page.locator('#tool-switcher .ts-btn[data-tool="schema-map"]').click();
    await page.waitForSelector('#graph-root g.node-group', { timeout: 15_000 });
    await expect(page.locator('#header-compare')).toBeVisible();
    await expect(page.locator('#diff-layer-master')).toBeVisible(); // diff overlay active
    expect(await page.locator('#header-compare .sn-dd-label').textContent()).toBe(cfgLabel);
  });
});
