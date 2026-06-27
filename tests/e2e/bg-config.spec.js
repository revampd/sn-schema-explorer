/**
 * E2E — the background-script CONFIG editor in the setup-instructions section.
 * Runs against the built dist/sn_schema_explorer.html. The panel rewrites the
 * displayed bg source (#code-bg) in place before the user copies it.
 */
import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_URL = `file:///${join(__dirname, '../../dist/sn_schema_explorer.html').replace(/\\/g, '/')}`;

async function openSetup(page) {
  await page.goto(APP_URL);
  await page.waitForLoadState('domcontentloaded');
  // The setup instructions live behind the landing <details> accordion.
  await page.locator('.landing-setup > summary').click();
  await expect(page.locator('#bg-config')).toBeVisible();
}

test('changing the format rewrites the bg CONFIG block in place', async ({ page }) => {
  await openSetup(page);
  const pre = page.locator('#code-bg');
  await expect(pre).toContainText("format: 'json'");

  // Output format is a custom dropdown (core/dropdown.js).
  const fmt = page.locator('#bg-config [data-bg-mount="format"]');
  await fmt.locator('.sn-dd-btn').click();
  await fmt.locator('.sn-dd-opt', { hasText: 'Markdown' }).click();
  await expect(pre).toContainText("format: 'markdown'");
});

test('toggling record counts and metadata sections updates the source', async ({ page }) => {
  await openSetup(page);
  const pre = page.locator('#code-bg');

  // Inputs are visually hidden inside .sn-toggle labels — click the label.
  await page.locator('#bg-config .sn-toggle:has(input[data-bg="includeRecordCounts"])').click();
  await expect(pre).toContainText('includeRecordCounts: true');

  await page
    .locator('#bg-config [data-bg-group="metadataSections"] .sn-toggle:has(input[value="plugins"])')
    .click();
  await expect(pre).toContainText("metadataSections: ['plugins']");
});

test('unchecking all edge types empties the array', async ({ page }) => {
  await openSetup(page);
  const pre = page.locator('#code-bg');
  await expect(pre).toContainText("edgeTypes: ['reference'");

  // Inputs are visually hidden inside .sn-toggle labels — click the label to uncheck.
  for (const v of ['reference', 'extends', 'm2m', 'rel', 'view', 'cmdb_rel']) {
    await page
      .locator(`#bg-config [data-bg-group="edgeTypes"] .sn-toggle:has(input[value="${v}"])`)
      .click();
  }
  await expect(pre).toContainText('edgeTypes: [],');
});
