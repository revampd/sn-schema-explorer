/**
 * E2E for config drift as a layer in the Schema Diff view (#139a):
 * the rich inspector Configuration section + the canvas badge, and the opt-in
 * gate (no config UI when the compare export lacks app metadata).
 *
 * Runs against the built dist/ — run `npm run build` first.
 */
import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_URL = `file:///${join(__dirname, '../../dist/sn_schema_explorer.html').replace(/\\/g, '/')}`;

// A scoped table "Widget" (scope display name "Widget App", matching the store
// app's name) that is BOTH structurally changed (compare adds a field) and
// config-drifted (app version differs) — so it appears in the diff list AND
// carries config drift. `appVersion` drives the drift; omit `withApps` to model
// an export that didn't include app metadata.
const schema = (name, appVersion, extraField, withApps = true) => ({
  _instance: { instance_name: name },
  nodes: [
    {
      id: 'incident',
      label: 'Incident',
      scope: 'Global',
      fields: [{ name: 'number', type: 'string' }],
    },
    {
      id: 'x_widget',
      label: 'Widget',
      scope: 'Widget App',
      fields: extraField
        ? [
            { name: 'a', type: 'string' },
            { name: 'b', type: 'string' },
          ]
        : [{ name: 'a', type: 'string' }],
    },
  ],
  edges: [{ source: 'x_widget', target: 'incident', type: 'reference', field: 'inc' }],
  ...(withApps
    ? {
        _metadata: {
          storeApps: [
            { scope: 'sn_widget', name: 'Widget App', version: appVersion, active: true },
          ],
        },
      }
    : {}),
});

async function loadApp(page) {
  await page.addInitScript(() =>
    localStorage.setItem('snse:settings:v1', JSON.stringify({ schemaDiff: true }))
  );
  await page.goto(APP_URL);
  await page.waitForLoadState('domcontentloaded');
}
async function register(page, data, fileName) {
  await page.locator('#file-input').setInputFiles({
    name: fileName,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(data)),
  });
}
async function pickDropdown(page, mountId, label) {
  await page.locator(`#${mountId} .sn-dd-btn`).click();
  await page.locator('body > .sn-dd-menu .sn-dd-opt', { hasText: label }).click();
}
async function openDiff(page, baseData, compareData) {
  await register(page, baseData, 'base.json'); // label: dev
  await register(page, compareData, 'compare.json'); // label: prod
  await page
    .locator('.inst-card:not(.add-card)')
    .first()
    .locator('[data-tool="schemaDiff"]')
    .click();
  await pickDropdown(page, 'diff-compare-mount', 'prod');
  await expect(page.locator('#diff-list .diff-item').first()).toBeVisible({ timeout: 10_000 });
}

test('Diff inspector shows the Configuration section with per-side versions + status', async ({
  page,
}) => {
  await loadApp(page);
  await openDiff(page, schema('dev', '2.0', false), schema('prod', '1.0', true));

  // Select the changed, drifted table from the diff list.
  await page.locator('#diff-list .diff-item', { hasText: 'Widget' }).first().click();

  const insp = page.locator('#inspector-content');
  await expect(insp).toContainText('Configuration');
  await expect(insp).toContainText('Widget App');
  await expect(insp.locator('.cfg-insp-status')).toHaveText('Drift');
  await expect(insp).toContainText('v2.0'); // base
  await expect(insp).toContainText('v1.0'); // compare

  // Canvas carries the at-a-glance badge for the drifted node.
  await expect(page.locator('circle.cfg-node-badge.cfgb-drift')).toHaveCount(1);
});

// Richer fixtures for the sidebar block: a drifted app (Widget App 2.0→1.0), a
// missing app (Legacy App, base only), and a structural change so the diff list
// is populated (openDiff waits for it).
const sbBase = {
  _instance: { instance_name: 'dev' },
  nodes: [
    {
      id: 'incident',
      label: 'Incident',
      scope: 'Global',
      fields: [{ name: 'number', type: 'string' }],
    },
    {
      id: 'x_widget',
      label: 'Widget',
      scope: 'Widget App',
      fields: [{ name: 'a', type: 'string' }],
    },
    {
      id: 'x_legacy',
      label: 'Legacy',
      scope: 'Legacy App',
      fields: [{ name: 'a', type: 'string' }],
    },
  ],
  edges: [{ source: 'x_widget', target: 'incident', type: 'reference', field: 'inc' }],
  _metadata: {
    storeApps: [
      { scope: 'sn_widget', name: 'Widget App', version: '2.0', active: true },
      { scope: 'sn_legacy', name: 'Legacy App', version: '1.0', active: true },
    ],
  },
};
const sbCompare = {
  _instance: { instance_name: 'prod' },
  nodes: [
    {
      id: 'incident',
      label: 'Incident',
      scope: 'Global',
      fields: [{ name: 'number', type: 'string' }],
    },
    {
      id: 'x_widget',
      label: 'Widget',
      scope: 'Widget App',
      fields: [
        { name: 'a', type: 'string' },
        { name: 'b', type: 'string' },
      ],
    },
    {
      id: 'x_legacy',
      label: 'Legacy',
      scope: 'Legacy App',
      fields: [{ name: 'a', type: 'string' }],
    },
  ],
  edges: [{ source: 'x_widget', target: 'incident', type: 'reference', field: 'inc' }],
  _metadata: {
    storeApps: [{ scope: 'sn_widget', name: 'Widget App', version: '1.0', active: true }],
  },
};

test('Diff sidebar shows a Configuration block: counts, app list, filter, highlight', async ({
  page,
}) => {
  await loadApp(page);
  await openDiff(page, sbBase, sbCompare);

  const block = page.locator('#diff-config');
  await expect(block).toBeVisible();
  // Counts: 1 drift (Widget App), 1 missing (Legacy App).
  await expect(block.locator('.dcs-drift .dcs-n')).toHaveText('1');
  await expect(block.locator('.dcs-missing .dcs-n')).toHaveText('1');
  // Default 'all' filter lists both changed apps.
  await expect(block.locator('.diff-config-item')).toHaveCount(2);

  // Filter to Missing → only Legacy App.
  await block.locator('.diff-config-stat.dcs-missing').click();
  await expect(block.locator('.diff-config-item')).toHaveCount(1);
  await expect(block.locator('.diff-config-item')).toContainText('Legacy App');
  await block.locator('.diff-config-stat.dcs-missing').click(); // clear filter

  // Pick the Widget App row → its owned table is brought into view & highlighted,
  // and its config drift shows in the inspector (reachable even though it isn't in
  // the structural diff list).
  await block.locator('.diff-config-item', { hasText: 'Widget App' }).click();
  await expect(page.locator('g.node-group.cfg-app-hi')).toHaveCount(1);
  await expect(page.locator('#inspector-content')).toContainText('Configuration');
});

test('no Configuration section when the compare export omits app metadata (opt-in)', async ({
  page,
}) => {
  await loadApp(page);
  // Compare has NO _metadata → config is not comparable; just a schema diff.
  await openDiff(page, schema('dev', '2.0', false), schema('prod', '1.0', true, false));

  await page.locator('#diff-list .diff-item', { hasText: 'Widget' }).first().click();
  const insp = page.locator('#inspector-content');
  await expect(insp).toContainText('Fields'); // structural diff still renders
  await expect(insp).not.toContainText('Configuration');
  await expect(page.locator('circle.cfg-node-badge')).toHaveCount(0);
  await expect(page.locator('#diff-config')).toBeHidden();
});
