/**
 * E2E for the header restructure (#127): the tool switcher replaces the
 * view-mode segment, and the header instance dropdown switches the loaded
 * instance (and sets the Base in Diff).
 */
import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { SCHEMA_OUTPUT } from '../fixtures/schema-output.js';
import { SCHEMA_OUTPUT_B } from '../fixtures/schema-output-b.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_URL = `file:///${join(__dirname, '../../dist/sn_schema_explorer.html').replace(/\\/g, '/')}`;

async function register(page, schema, name) {
  await page.locator('#file-input').setInputFiles({
    name,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(schema)),
  });
}

test('header instance dropdown switches the loaded instance', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('snse:settings:v1', JSON.stringify({ pathFinding: true }))
  );
  await page.goto(APP_URL);
  await page.waitForLoadState('domcontentloaded');
  await register(page, SCHEMA_OUTPUT, 'base.json'); // test-instance
  await register(page, SCHEMA_OUTPUT_B, 'compare.json'); // test-instance-b

  // Open the first instance in Schema Explorer.
  await page
    .locator('.inst-card:not(.add-card)')
    .first()
    .locator('[data-tool="schemaExplorer"]')
    .click();
  await page.waitForSelector('svg .node, svg circle', { timeout: 15_000 });

  // Header chrome: switcher shows Schema Map (active) + Path Finder; instance
  // dropdown shows the loaded instance.
  await expect(page.locator('#tool-switcher .ts-btn[data-tool="schema-map"]')).toHaveClass(
    /active/
  );
  await expect(page.locator('#tool-switcher .ts-btn[data-tool="path"]')).toBeVisible();
  await expect(page.locator('#header-instance .sn-dd-label')).toHaveText('test-instance');

  // Switch the loaded instance via the header dropdown.
  await page.locator('#header-instance .sn-dd-btn').click();
  await page.locator('body > .sn-dd-menu .sn-dd-opt', { hasText: 'test-instance-b' }).click();
  await expect(page.locator('#header-instance .sn-dd-label')).toHaveText('test-instance-b');
});

test('tool switcher enters Path Finder and returns to Schema Map', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('snse:settings:v1', JSON.stringify({ pathFinding: true }))
  );
  await page.goto(APP_URL);
  await page.waitForLoadState('domcontentloaded');
  await register(page, SCHEMA_OUTPUT, 'base.json'); // test-instance
  await register(page, SCHEMA_OUTPUT_B, 'compare.json'); // test-instance-b
  await page
    .locator('.inst-card:not(.add-card)')
    .first()
    .locator('[data-tool="schemaExplorer"]')
    .click();
  await page.waitForSelector('svg .node, svg circle', { timeout: 15_000 });

  await page.locator('#tool-switcher .ts-btn[data-tool="path"]').click();
  await expect(page.locator('#pf-sidebar')).toBeVisible();
  await expect(page.locator('#tool-switcher .ts-btn[data-tool="path"]')).toHaveClass(/active/);
  // Path Finder's sidebar omits the density controls, application scopes, and the
  // sort bar.
  await expect(page.locator('#density-group')).toBeHidden();
  await expect(page.locator('#scope-info-group')).toBeHidden();
  await expect(page.locator('#sort-bar')).toBeHidden();

  // …and they must stay hidden after a header-dropdown instance switch (which
  // re-runs loadGraph).
  await page.locator('#header-instance .sn-dd-btn').click();
  await page.locator('body > .sn-dd-menu .sn-dd-opt', { hasText: 'test-instance-b' }).click();
  await expect(page.locator('#density-group')).toBeHidden();
  await expect(page.locator('#scope-info-group')).toBeHidden();
  await expect(page.locator('#sort-bar')).toBeHidden();

  await page.locator('#tool-switcher .ts-btn[data-tool="schema-map"]').click();
  await expect(page.locator('#pf-sidebar')).toBeHidden();
  await expect(page.locator('#tool-switcher .ts-btn[data-tool="schema-map"]')).toHaveClass(
    /active/
  );
});

test('shared focus: selected table carries from Schema Map into Path Finder (#131)', async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem('snse:settings:v1', JSON.stringify({ pathFinding: true }))
  );
  await page.goto(APP_URL);
  await page.waitForLoadState('domcontentloaded');
  await register(page, SCHEMA_OUTPUT, 'base.json');
  await page
    .locator('.inst-card:not(.add-card)')
    .first()
    .locator('[data-tool="schemaExplorer"]')
    .click();
  await page.waitForSelector('#graph-root g.node-group', { timeout: 15_000 });

  // Select a table in Schema Map and capture which one the focus landed on.
  await page.locator('#graph-root g.node-group').first().click();
  const focused = await page.locator('#stat-focus').textContent();
  expect(focused).not.toBe('—');

  // Switch lenses — the focused table must follow into Path Finder's source.
  await page.locator('#tool-switcher .ts-btn[data-tool="path"]').click();
  await expect(page.locator('#pf-sidebar')).toBeVisible();
  await expect(page.locator('#pf-source')).toHaveValue(focused.trim());
});

test('with a comparison active, the header dropdown switches the Base (synced with sidebar)', async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem('snse:settings:v1', JSON.stringify({ schemaDiff: true }))
  );
  await page.goto(APP_URL);
  await page.waitForLoadState('domcontentloaded');
  await register(page, SCHEMA_OUTPUT, 'base.json'); // test-instance
  await register(page, SCHEMA_OUTPUT_B, 'compare.json'); // test-instance-b

  // #141: open the base on the map, then start a comparison from the header.
  await page
    .locator('.inst-card:not(.add-card)')
    .first()
    .locator('[data-tool="schemaExplorer"]')
    .click();
  await page.waitForSelector('#graph-root g.node-group', { timeout: 15_000 });
  await page.locator('#header-compare .sn-dd-btn').click();
  await page.locator('body > .sn-dd-menu .sn-dd-opt', { hasText: 'vs test-instance-b' }).click();
  await expect(page.locator('#diff-sidebar')).toBeVisible();

  // The header instance dropdown switches the Base. Here the only compare is
  // test-instance-b, so switching the base ONTO it would make the compare equal
  // the base — an instance can't compare against itself (#150), so the comparison
  // clears and the default sidebar returns.
  await expect(page.locator('#header-instance .sn-dd-label')).toHaveText('test-instance');
  await page.locator('#header-instance .sn-dd-btn').click();
  await page.locator('body > .sn-dd-menu .sn-dd-opt', { hasText: 'test-instance-b' }).click();
  await expect(page.locator('#header-instance .sn-dd-label')).toHaveText('test-instance-b');
  await expect(page.locator('#diff-sidebar')).toBeHidden();
  await expect(page.locator('#table-list')).toBeVisible();
});
