/**
 * Safety net for the force / diff / path modes (#140) — landed BEFORE the mode
 * collapse (#141), which turns Diff from a view-mode into a layer on the Schema
 * Map. These tests lock the cross-mode invariants most at risk in that refactor:
 *   - which sidebar regions show in each mode,
 *   - the canvas diff colouring + inspector field/relationship detail,
 *   - the Path Finder surface,
 *   - and a full round-trip that must leave no diff residue on the map.
 *
 * Runs against the built dist/ — run `npm run build` first.
 */
import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { SCHEMA_OUTPUT } from '../fixtures/schema-output.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_URL = `file:///${join(__dirname, '../../dist/sn_schema_explorer.html').replace(/\\/g, '/')}`;

// Compare = base + one added table (`problem`) + one changed table (`incident`
// gains a field), so the diff has both added and changed entries.
function makeCompare() {
  const c = JSON.parse(JSON.stringify(SCHEMA_OUTPUT));
  c._instance = { ...(c._instance || {}), instance_name: 'compare-inst' };
  c.nodes.push({ id: 'problem', label: 'Problem', scope: 'Global', fields: [] });
  const incident = c.nodes.find(n => n.id === 'incident');
  incident.fields = [
    ...(incident.fields || []),
    { name: 'new_field', label: 'New', type: 'string' },
  ];
  return c;
}

// A second, distinct compare for the multi-select tests (#150): adds a different
// table and changes a different one, so its per-table statuses differ from
// makeCompare()'s. Named so it isn't a substring of 'compare-inst'.
function makeRival() {
  const c = JSON.parse(JSON.stringify(SCHEMA_OUTPUT));
  c._instance = { ...(c._instance || {}), instance_name: 'rival-inst' };
  c.nodes.push({ id: 'change_request', label: 'Change', scope: 'Global', fields: [] });
  const task = c.nodes.find(n => n.id === 'task');
  if (task)
    task.fields = [...(task.fields || []), { name: 'rival_field', label: 'R', type: 'string' }];
  return c;
}

async function boot(page) {
  await page.addInitScript(() =>
    localStorage.setItem(
      'snse:settings:v1',
      JSON.stringify({ pathFinding: true, schemaDiff: true })
    )
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

test('force (Schema Map): default sidebar regions + inspector fields', async ({ page }) => {
  await boot(page);
  await register(page, SCHEMA_OUTPUT, 'base.json');
  await page
    .locator('.inst-card:not(.add-card)')
    .first()
    .locator('[data-tool="schemaExplorer"]')
    .click();
  await page.waitForSelector('#graph-root g.node-group', { timeout: 15_000 });

  await expect(page.locator('#table-list')).toBeVisible();
  await expect(page.locator('#sort-bar')).toBeVisible();
  await expect(page.locator('#scope-info-group')).toBeVisible();
  await expect(page.locator('#density-group')).toBeVisible();
  await expect(page.locator('#diff-sidebar')).toBeHidden();
  await expect(page.locator('#pf-sidebar')).toBeHidden();

  await page.locator('#table-list-viewport .table-item[data-id="incident"]').click();
  await expect(page.locator('#inspector-content')).toContainText('Fields');
});

test('diff layer: canvas colouring, summary counts, sidebar list, inspector detail', async ({
  page,
}) => {
  await boot(page);
  await register(page, SCHEMA_OUTPUT, 'base.json');
  await register(page, makeCompare(), 'compare.json');
  await page
    .locator('.inst-card:not(.add-card)')
    .first()
    .locator('[data-tool="schemaExplorer"]')
    .click();
  await page.waitForSelector('#graph-root g.node-group', { timeout: 15_000 });
  await page.locator('#header-compare .sn-dd-btn').click();
  await page.locator('body > .sn-dd-menu .sn-dd-opt', { hasText: 'vs compare-inst' }).click();

  // Sidebar: diff sidebar shown, default regions hidden, summary + list populated.
  await expect(page.locator('#diff-sidebar')).toBeVisible();
  await expect(page.locator('#table-list')).toBeHidden();
  await expect(page.locator('#diff-n-added')).toHaveText('1'); // problem
  await expect(page.locator('#diff-n-changed')).toHaveText('1'); // incident
  await expect(page.locator('#diff-list .diff-item', { hasText: 'Incident' })).toBeVisible({
    timeout: 10_000,
  });

  // Select the changed table → canvas carries the diff class + inspector shows the
  // side-by-side field detail and the relationship section heading.
  await page.locator('#diff-list .diff-item', { hasText: 'Incident' }).click();
  await expect(page.locator('g.node-group.diff-changed')).not.toHaveCount(0);
  const insp = page.locator('#inspector-content');
  await expect(insp).toContainText('Fields');

  // The comparison overlay is always on while comparing — there is no layer
  // toggle (Differences / Config-drift buttons removed).
  await expect(page.locator('#diff-layer-master, #cfg-drift-toggle')).toHaveCount(0);
  await expect(page.locator('g.node-group.diff-changed')).not.toHaveCount(0);
  // #150: the comparison inspector is now an N-column matrix — columns are headed
  // by the actual instance labels (Base + each compare), not the generic word
  // "Compare". The compare instance's label appears as a column header.
  await expect(insp).toContainText('compare-inst');
});

test('path: pf sidebar + default regions hidden + a path renders', async ({ page }) => {
  await boot(page);
  await register(page, SCHEMA_OUTPUT, 'base.json');
  await page
    .locator('.inst-card:not(.add-card)')
    .first()
    .locator('[data-tool="schemaExplorer"]')
    .click();
  await page.waitForSelector('#graph-root g.node-group', { timeout: 15_000 });

  await page.locator('#tool-switcher .ts-btn[data-tool="path"]').click();
  await expect(page.locator('#pf-sidebar')).toBeVisible();
  await expect(page.locator('#density-group')).toBeHidden();
  await expect(page.locator('#scope-info-group')).toBeHidden();
  await expect(page.locator('#sort-bar')).toBeHidden();

  await page.locator('#pf-source').fill('incident');
  await page.locator('#pf-target').fill('sys_user');
  await page.locator('#pf-find').click();
  await expect(page.locator('#pf-result')).toContainText('task');
});

test('round-trip map→compare→path→map→clear leaves no diff residue', async ({ page }) => {
  await boot(page);
  await register(page, SCHEMA_OUTPUT, 'base.json');
  await register(page, makeCompare(), 'compare.json');
  await page
    .locator('.inst-card:not(.add-card)')
    .first()
    .locator('[data-tool="schemaExplorer"]')
    .click();
  await page.waitForSelector('#graph-root g.node-group', { timeout: 15_000 });

  // Start a comparison (layer on the map), then go to Path Finder and back.
  await page.locator('#header-compare .sn-dd-btn').click();
  await page.locator('body > .sn-dd-menu .sn-dd-opt', { hasText: 'vs compare-inst' }).click();
  await expect(page.locator('#diff-list .diff-item').first()).toBeVisible({ timeout: 10_000 });

  await page.locator('#tool-switcher .ts-btn[data-tool="path"]').click();
  await expect(page.locator('#pf-sidebar')).toBeVisible();
  await page.locator('#tool-switcher .ts-btn[data-tool="schema-map"]').click();
  // Comparison is still active after the round-trip — the diff sidebar returns.
  await expect(page.locator('#diff-sidebar')).toBeVisible();

  // Clearing the comparison restores the default sidebar with no diff residue.
  await page.locator('#header-compare .sn-dd-btn').click();
  await page.locator('body > .sn-dd-menu .sn-dd-opt', { hasText: 'Compare: none' }).click();
  await expect(page.locator('#table-list')).toBeVisible();
  await expect(page.locator('#diff-sidebar')).toBeHidden();
  await expect(page.locator('#pf-sidebar')).toBeHidden();
  await expect(page.locator('g.node-group.diff-changed')).toHaveCount(0);
  await expect(page.locator('g.node-group.diff-added')).toHaveCount(0);
  await expect(page.locator('#table-list-viewport .table-item[data-id="problem"]')).toHaveCount(0);
});

test('multi-compare (#150): N columns in the header chips, sidebar + inspector', async ({
  page,
}) => {
  await boot(page);
  await register(page, SCHEMA_OUTPUT, 'base.json');
  await register(page, makeCompare(), 'compare.json'); // compare-inst
  await register(page, makeRival(), 'rival.json'); // rival-inst
  await page
    .locator('.inst-card:not(.add-card)')
    .first()
    .locator('[data-tool="schemaExplorer"]')
    .click();
  await page.waitForSelector('#graph-root g.node-group', { timeout: 15_000 });

  // The Compare control is a single dropdown whose rows are toggles (#150): a ✓
  // marks instances already in the comparison. Toggle two on.
  const toggleCompare = async label => {
    await page.locator('#header-compare .sn-dd-btn').click();
    await page.locator('body > .sn-dd-menu .sn-dd-opt', { hasText: label }).click();
  };
  await toggleCompare('vs compare-inst');
  await toggleCompare('vs rival-inst');

  // The button summarises the multi-selection (no chips).
  await expect(page.locator('#header-compare .sn-dd-label')).toHaveText('Compare: 2 instances');

  // Sidebar switches to the N-column roll-up: one row per differing table, each
  // with a per-instance status strip (a chip per compare).
  await expect(page.locator('#diff-list .diff-group-header')).toContainText(
    'Differs across instances'
  );
  await expect(page.locator('#diff-list .diff-item').first().locator('.dic-chip')).toHaveCount(2);

  // Inspector for a differing table shows one column per instance (Base + 2).
  await page.locator('#diff-list .diff-item', { hasText: 'Incident' }).click();
  await expect(page.locator('#inspector-content .diff-sbs-col-header')).toHaveCount(3);

  // A table added ONLY in a non-primary compare (change_request, in rival) isn't
  // grafted onto the map — its sidebar row must still open the inspector (#150
  // off-map navigation), not silently no-op.
  await page.locator('#diff-list .diff-item', { hasText: 'change_request' }).click();
  await expect(page.locator('#inspector-content')).toContainText('change_request');

  // Toggling a compare back off (its row now carries ✓) drops to the single-
  // compare classic grouped list.
  await toggleCompare('✓ vs compare-inst');
  await expect(page.locator('#header-compare .sn-dd-label')).toHaveText('vs rival-inst');
  await expect(page.locator('#diff-list .diff-group-header').first()).not.toContainText(
    'Differs across instances'
  );
});
