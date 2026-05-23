/**
 * D3 version performance benchmark — 7.8.5 vs 7.9.0
 *
 * Builds two HTML variants (one per D3 version) then uses Playwright to:
 *  1. Load the large schema (schema_samples/bg_script_export_schema.json)
 *  2. Measure time-to-first-node (schema parse + first simulation tick)
 *  3. Measure time-to-stable-simulation (until tick rate drops to ~idle)
 *  4. Measure frame budget during pan interaction (rAF timing)
 *
 * Usage:
 *   node benchmark/bench.js
 *
 * Requirements: npm install already run (playwright + d3 present)
 */
import { chromium }       from 'playwright';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'fs';
import { execSync }       from 'child_process';
import { fileURLToPath }  from 'url';
import { join, dirname }  from 'path';

const __dir  = dirname(fileURLToPath(import.meta.url));
const root   = join(__dir, '..');
const dist   = join(root, 'dist');

// ── Step 1: Build variant for installed D3 (7.9.0) ──────────────────────────
console.log('\n── Building D3 7.9.0 variant ──────────────────────────────────');
execSync('node build.js full', { cwd: root, stdio: 'inherit' });
copyFileSync(join(dist, 'sn_schema_explorer.html'),
             join(dist, 'bench-d3-790.html'));

// ── Step 2: Stash 7.9.0 dist, install 7.8.5, build, restore ────────────────
console.log('\n── Building D3 7.8.5 variant ──────────────────────────────────');
const d3Min790 = readFileSync(join(root, 'node_modules/d3/dist/d3.min.js'), 'utf8');
execSync('npm install --save-dev d3@7.8.5 --no-audit --fund=false', { cwd: root, stdio: 'inherit' });
execSync('node build.js full', { cwd: root, stdio: 'inherit' });
copyFileSync(join(dist, 'sn_schema_explorer.html'),
             join(dist, 'bench-d3-785.html'));

// Restore 7.9.0
console.log('\n── Restoring D3 7.9.0 ─────────────────────────────────────────');
execSync('npm install --save-dev d3@7.9.0 --no-audit --fund=false', { cwd: root, stdio: 'inherit' });
// Also rebuild the production file so it ends on 7.9.0
execSync('node build.js full', { cwd: root, stdio: 'inherit' });

// ── Step 3: Run Playwright benchmark ────────────────────────────────────────
const SCHEMA = readFileSync(join(root, 'schema_samples/bg_script_export_schema.json'), 'utf8');
const RUNS   = 3;   // runs per version (median reported)

const VARIANTS = [
  { label: 'D3 7.8.5', file: join(dist, 'bench-d3-785.html') },
  { label: 'D3 7.9.0', file: join(dist, 'bench-d3-790.html') },
];

async function measureVariant(browser, htmlPath, label) {
  console.log(`\n  Testing ${label} (${RUNS} runs)…`);
  const results = [];

  for (let run = 0; run < RUNS; run++) {
    const context = await browser.newContext();
    const page    = await context.newPage();

    // Capture console errors
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    const url = `file:///${htmlPath.replace(/\\/g, '/')}`;
    await page.goto(url);
    await page.waitForLoadState('domcontentloaded');

    const t0 = Date.now();

    // Load the schema via the file input
    await page.locator('#file-input').setInputFiles({
      name: 'schema.json',
      mimeType: 'application/json',
      buffer: Buffer.from(SCHEMA),
    });

    // --- Metric 1: time to first node rendered ---
    const t1Start = Date.now();
    await page.waitForSelector('#graph-root g.node-group', { timeout: 60_000 });
    const timeToFirstNode = Date.now() - t1Start;

    // --- Metric 2: time to simulation stable ---
    // Poll stat-nodes + stat-edges until they stop changing; give up at 30 s.
    const stableStart = Date.now();
    let stableTime = null;
    let lastNodes = '', lastEdges = '', stableCount = 0;
    for (let i = 0; i < 300; i++) {
      await page.waitForTimeout(100);
      const nodes = await page.locator('#stat-nodes').textContent().catch(() => '');
      const edges = await page.locator('#stat-edges').textContent().catch(() => '');
      if (nodes === lastNodes && edges === lastEdges) {
        stableCount++;
        if (stableCount >= 5) { stableTime = Date.now() - stableStart; break; }
      } else {
        stableCount = 0;
        lastNodes = nodes; lastEdges = edges;
      }
    }
    if (!stableTime) stableTime = Date.now() - stableStart; // timeout

    // --- Metric 3: frame timing during pan ---
    // Simulate a drag across the canvas and measure rAF frame budget.
    const canvas = page.locator('#graph-root');
    const box    = await canvas.boundingBox();
    const cx = box ? box.x + box.width / 2  : 400;
    const cy = box ? box.y + box.height / 2 : 300;

    const frameTimes = await page.evaluate(async ({ cx, cy }) => {
      return new Promise(resolve => {
        const times = [];
        let last = performance.now();
        let frames = 0;

        function tick(now) {
          times.push(now - last);
          last = now;
          if (++frames < 60) requestAnimationFrame(tick);
          else resolve(times.slice(1)); // drop first (may include setup jank)
        }
        requestAnimationFrame(tick);

        // Simulate pan while collecting frames
        const el = document.getElementById('graph-root');
        if (el) {
          el.dispatchEvent(new MouseEvent('mousedown', { clientX: cx, clientY: cy, bubbles: true }));
          for (let dx = 0; dx < 200; dx += 10) {
            el.dispatchEvent(new MouseEvent('mousemove', { clientX: cx + dx, clientY: cy, bubbles: true }));
          }
          el.dispatchEvent(new MouseEvent('mouseup',   { clientX: cx + 200, clientY: cy, bubbles: true }));
        }
      });
    }, { cx, cy });

    const sorted  = [...frameTimes].sort((a, b) => a - b);
    const p50     = sorted[Math.floor(sorted.length * 0.50)];
    const p95     = sorted[Math.floor(sorted.length * 0.95)];
    const avgFps  = frameTimes.length > 0
      ? Math.round(1000 / (frameTimes.reduce((s, t) => s + t, 0) / frameTimes.length))
      : 0;

    results.push({ timeToFirstNode, stableTime, p50, p95, avgFps, errors: errors.length });
    console.log(`    Run ${run + 1}: first-node=${timeToFirstNode}ms  stable=${stableTime}ms  p50=${p50.toFixed(1)}ms  p95=${p95.toFixed(1)}ms  fps≈${avgFps}  errors=${errors.length}`);

    await context.close();
  }

  // Return medians
  const med = arr => {
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  return {
    label,
    timeToFirstNode: med(results.map(r => r.timeToFirstNode)),
    stableTime:      med(results.map(r => r.stableTime)),
    p50:             med(results.map(r => r.p50)),
    p95:             med(results.map(r => r.p95)),
    avgFps:          med(results.map(r => r.avgFps)),
    errors:          results.reduce((s, r) => s + r.errors, 0),
  };
}

console.log('\n── Running Playwright benchmark ───────────────────────────────');
console.log(`   Schema: 6790 nodes / 29508 edges`);
console.log(`   Runs per variant: ${RUNS} (median reported)`);

const browser = await chromium.launch({ headless: true });
const allResults = [];
for (const v of VARIANTS) {
  allResults.push(await measureVariant(browser, v.file, v.label));
}
await browser.close();

// ── Step 4: Print report ────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════════════');
console.log('  BENCHMARK RESULTS  (median of', RUNS, 'runs, headless Chromium)');
console.log('══════════════════════════════════════════════════════════════');
console.log(
  `  ${'Version'.padEnd(12)} ${'First node'.padStart(12)} ${'Sim stable'.padStart(12)} ${'Frame p50'.padStart(10)} ${'Frame p95'.padStart(10)} ${'Avg FPS'.padStart(8)}`
);
console.log('  ' + '─'.repeat(68));
for (const r of allResults) {
  console.log(
    `  ${r.label.padEnd(12)} ${(r.timeToFirstNode + 'ms').padStart(12)} ${(r.stableTime + 'ms').padStart(12)} ${(r.p50.toFixed(1) + 'ms').padStart(10)} ${(r.p95.toFixed(1) + 'ms').padStart(10)} ${(r.avgFps + ' fps').padStart(8)}`
  );
}
console.log('══════════════════════════════════════════════════════════════\n');

if (allResults.length === 2) {
  const [a, b] = allResults;
  const delta = (old, nw, unit = 'ms') => {
    const diff = nw - old;
    const pct  = ((diff / old) * 100).toFixed(1);
    const sign = diff > 0 ? '+' : '';
    return `${sign}${diff}${unit} (${sign}${pct}%)`;
  };
  console.log('  Delta (7.9.0 vs 7.8.5):');
  console.log(`    First node:  ${delta(a.timeToFirstNode, b.timeToFirstNode)}`);
  console.log(`    Sim stable:  ${delta(a.stableTime,      b.stableTime)}`);
  console.log(`    Frame p50:   ${delta(a.p50,             b.p50)}`);
  console.log(`    Frame p95:   ${delta(a.p95,             b.p95)}`);
  console.log('');
}
