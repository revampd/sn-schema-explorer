/**
 * E2E for the inline-prompt replacement of window.prompt() (#46.5),
 * exercised via the Saved Views "save" flow.
 */
import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { SCHEMA_OUTPUT } from '../fixtures/schema-output.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_URL = `file:///${join(__dirname, '../../dist/sn_schema_explorer.html').replace(/\\/g, '/')}`;

async function loadApp(page) {
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

test('saving a view uses the inline prompt and adds the view', async ({ page }) => {
  await loadApp(page);
  await injectSchema(page, SCHEMA_OUTPUT);

  await page.locator('#btn-save-view').click();
  const input = page.locator('.inline-prompt-overlay .inline-prompt-input');
  await expect(input).toBeVisible();
  await input.fill('My E2E View');
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page.locator('#views-list .view-item')).toHaveCount(1);
  await expect(page.locator('#views-list .view-item').first()).toContainText('My E2E View');
});

test('cancelling the inline prompt (Escape) adds nothing', async ({ page }) => {
  await loadApp(page);
  await injectSchema(page, SCHEMA_OUTPUT);

  await page.locator('#btn-save-view').click();
  const input = page.locator('.inline-prompt-overlay .inline-prompt-input');
  await expect(input).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.inline-prompt-overlay')).toHaveCount(0);
  await expect(page.locator('#views-list .view-item')).toHaveCount(0);
});
