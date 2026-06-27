/**
 * E2E for the config-drift map overlay (#133) — the first cross-lens synergy:
 * the Config lens tinting Schema Map nodes by application drift.
 */
import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_URL = `file:///${join(__dirname, '../../dist/sn_schema_explorer.html').replace(/\\/g, '/')}`;

// A two-node schema: one Global table, one scoped table whose scope DISPLAY name
// ("Secrets Management") matches the store app's name — the spine's display-name
// join. `appVersion` drifts the store app across instances.
const schema = (name, appVersion) => ({
  _instance: { instance_name: name },
  nodes: [
    { id: 'incident', label: 'Incident', scope: 'Global', fields: [] },
    { id: 'x_sm_secret', label: 'Secret', scope: 'Secrets Management', fields: [] },
  ],
  edges: [{ source: 'x_sm_secret', target: 'incident', type: 'reference', field: 'inc' }],
  _metadata: {
    storeApps: [{ scope: 'sn_sm', name: 'Secrets Management', version: appVersion, active: true }],
  },
});

async function register(page, data, fileName) {
  await page.locator('#file-input').setInputFiles({
    name: fileName,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(data)),
  });
}

test('config-drift layer tints a drifted scoped table and clears on toggle off', async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem('snse:settings:v1', JSON.stringify({ configData: true }))
  );
  await page.goto(APP_URL);
  await page.waitForLoadState('domcontentloaded');

  // Two instances whose shared store app drifts (2.0 vs 1.0).
  await register(page, schema('dev', '2.0'), 'dev.json');
  await register(page, schema('prod', '1.0'), 'prod.json');

  // Open Schema Map on the first instance.
  await page
    .locator('.inst-card:not(.add-card)')
    .first()
    .locator('[data-tool="schemaExplorer"]')
    .click();
  await page.waitForSelector('#graph-root g.node-group', { timeout: 15_000 });

  // Focus the scoped table from the sidebar so it's in view (the referencing edge
  // is hidden by default, so it isn't pulled in around the auto-focused table).
  await page.locator('#table-list .table-item[data-id="x_sm_secret"]').click();
  await expect(page.locator('#graph-root g.node-group.selected')).toBeVisible();

  // The layer control is available (≥2 app-capable instances) but off by default.
  const toggle = page.locator('#cfg-drift-toggle');
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('g.node-group.cfg-drift')).toHaveCount(0);

  // Turn it on → the scoped, drifted table tints; the Global table does not.
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('g.node-group.cfg-drift')).toHaveCount(1);
  await expect(page.locator('g.node-group.cfg-sync')).toHaveCount(0);

  // Turn it off → tint fully cleared.
  await toggle.click();
  await expect(page.locator('g.node-group.cfg-drift')).toHaveCount(0);
});

test('config-drift layer is hidden with only one instance (nothing to compare)', async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem('snse:settings:v1', JSON.stringify({ configData: true }))
  );
  await page.goto(APP_URL);
  await page.waitForLoadState('domcontentloaded');
  await register(page, schema('dev', '2.0'), 'dev.json');
  await page
    .locator('.inst-card:not(.add-card)')
    .first()
    .locator('[data-tool="schemaExplorer"]')
    .click();
  await page.waitForSelector('#graph-root g.node-group', { timeout: 15_000 });

  await expect(page.locator('#cfg-drift-layer')).toBeHidden();
});
