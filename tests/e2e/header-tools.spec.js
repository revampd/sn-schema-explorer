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
  await register(page, SCHEMA_OUTPUT, 'base.json');
  await page
    .locator('.inst-card:not(.add-card)')
    .first()
    .locator('[data-tool="schemaExplorer"]')
    .click();
  await page.waitForSelector('svg .node, svg circle', { timeout: 15_000 });

  await page.locator('#tool-switcher .ts-btn[data-tool="path"]').click();
  await expect(page.locator('#pf-sidebar')).toBeVisible();
  await expect(page.locator('#tool-switcher .ts-btn[data-tool="path"]')).toHaveClass(/active/);

  await page.locator('#tool-switcher .ts-btn[data-tool="schema-map"]').click();
  await expect(page.locator('#pf-sidebar')).toBeHidden();
  await expect(page.locator('#tool-switcher .ts-btn[data-tool="schema-map"]')).toHaveClass(
    /active/
  );
});

test('in Diff, header dropdown reflects and sets the Base (synced with sidebar)', async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem('snse:settings:v1', JSON.stringify({ schemaDiff: true }))
  );
  await page.goto(APP_URL);
  await page.waitForLoadState('domcontentloaded');
  await register(page, SCHEMA_OUTPUT, 'base.json'); // test-instance
  await register(page, SCHEMA_OUTPUT_B, 'compare.json'); // test-instance-b

  // Launch Diff on the first instance.
  await page
    .locator('.inst-card:not(.add-card)')
    .first()
    .locator('[data-tool="schemaDiff"]')
    .click();
  await expect(page.locator('#diff-sidebar')).toBeVisible();
  await expect(page.locator('#tool-switcher .ts-btn[data-tool="diff"]')).toHaveClass(/active/);

  // Header dropdown reflects the Base; switching it sets the new Base, and the
  // sidebar Base picker stays in sync.
  await expect(page.locator('#header-instance .sn-dd-label')).toHaveText('test-instance');
  await page.locator('#header-instance .sn-dd-btn').click();
  await page.locator('body > .sn-dd-menu .sn-dd-opt', { hasText: 'test-instance-b' }).click();
  await expect(page.locator('#header-instance .sn-dd-label')).toHaveText('test-instance-b');
  await expect(page.locator('#diff-base-mount .sn-dd-label')).toHaveText('test-instance-b');
});
