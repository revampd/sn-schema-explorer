/**
 * E2E guard for the filter builder's body-portalled "+ Add condition" picker
 * (#46.11) — adding a condition through it must still work end-to-end.
 */
import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { SCHEMA_OUTPUT } from '../fixtures/schema-output.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_URL = `file:///${join(__dirname, '../../dist/sn_schema_explorer.html').replace(/\\/g, '/')}`;

test('adding a condition via the portalled picker updates the badge and rows', async ({ page }) => {
  await page.goto(APP_URL);
  await page.waitForLoadState('domcontentloaded');
  await page.locator('#file-input').setInputFiles({
    name: 'schema.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(SCHEMA_OUTPUT)),
  });
  await page.locator('[data-tool="schemaExplorer"]').click();
  await page.waitForSelector('svg .node, svg g.node, svg circle', { timeout: 15_000 });

  await page.locator('#scope-filter-btn').click();
  await page.locator('#filter-body .fc-add-btn').click();

  // Picker is portalled to <body>, not inside #filter-body.
  const scopeItem = page.locator('.fc-picker .fc-picker-item', { hasText: 'Application Scope' });
  await expect(scopeItem).toBeVisible();
  await scopeItem.click();

  await expect(page.locator('#filter-body .fc-row')).toHaveCount(1);
  await expect(page.locator('#filter-badge')).toHaveText('1');
});

test('the Has Edge condition uses the custom edge-type dropdown', async ({ page }) => {
  await page.goto(APP_URL);
  await page.waitForLoadState('domcontentloaded');
  await page.locator('#file-input').setInputFiles({
    name: 'schema.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(SCHEMA_OUTPUT)),
  });
  await page.locator('[data-tool="schemaExplorer"]').click();
  await page.waitForSelector('svg .node, svg g.node, svg circle', { timeout: 15_000 });

  await page.locator('#scope-filter-btn').click();
  await page.locator('#filter-body .fc-add-btn').click();
  await page.locator('.fc-picker .fc-picker-item', { hasText: 'Has Edge' }).click();

  // The edge-type picker is the custom dropdown (core/dropdown.js), not a <select>.
  const dd = page.locator('#filter-body .fc-row .fc-select.sn-dd');
  await expect(dd).toBeVisible();
  await expect(page.locator('#filter-body .fc-row select')).toHaveCount(0);

  await dd.locator('.sn-dd-btn').click();
  await expect(dd.locator('.sn-dd-menu .sn-dd-opt').first()).toBeVisible();
  const optCount = await dd.locator('.sn-dd-opt').count();
  expect(optCount).toBeGreaterThan(1);
  await dd.locator('.sn-dd-opt').nth(1).click();
  await expect(dd.locator('.sn-dd-menu')).toBeHidden(); // selection closes the menu
});
