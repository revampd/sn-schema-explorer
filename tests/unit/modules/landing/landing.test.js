/**
 * @vitest-environment jsdom
 *
 * Unit tests for src/modules/landing/index.js — the front-door landing
 * page (#101). Card-based layout: a grid of instance cards (with read-only
 * section status + per-instance tool icons) plus an Add-instance card.
 *
 * load/index.js drags in d3/canvas via render.js — stub it so we exercise only
 * the landing wiring. engine/workspace.js is stubbed to observe setWorkspace.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import '../../../helpers/localstorage.js';

const { selectInstanceForGraph, setWorkspace, onWorkspaceChange } = vi.hoisted(() => ({
  selectInstanceForGraph: vi.fn(() => true),
  setWorkspace: vi.fn(),
  onWorkspaceChange: vi.fn(),
}));
vi.mock('../../../../src/modules/load/index.js', () => ({ selectInstanceForGraph }));
vi.mock('../../../../src/core/workspace.js', () => ({ setWorkspace, onWorkspaceChange }));

import {
  registerTool,
  renderInstances,
  refreshLanding,
  initLanding,
  instanceSubtitle,
  applyBgConfig,
  _resetTools,
} from '../../../../src/modules/landing/index.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { addInstance, getInstance, _resetInstances } from '../../../../src/core/instances-state.js';

const SCHEMA_DATA = {
  _instance: { instance_name: 'dev1' },
  _stats: { counts: { tables: 5 } },
  nodes: [{ id: 'task' }],
  edges: [],
};
const PLUGIN_DATA = {
  nodes: [{ id: 'task' }],
  edges: [],
  _metadata: {
    plugins: [
      { id: 'com.x', name: 'X' },
      { id: 'com.y', name: 'Y' },
    ],
  },
};

function setupDom() {
  document.body.innerHTML = `
    <button id="btn-home"></button>
    <input type="file" id="file-input" hidden>
    <div id="landing-instances"></div>
  `;
}
const cardTool = (id, key) =>
  document.querySelector(`.inst-card[data-instance="${id}"] [data-tool="${key}"]`);

beforeEach(() => {
  _resetInstances();
  _resetTools();
  localStorage.clear();
  selectInstanceForGraph.mockClear();
  setWorkspace.mockClear();
  setupDom();
});

describe('instance cards', () => {
  it('renders a card per instance plus an Add-instance card', () => {
    addInstance({ label: 'dev1', data: SCHEMA_DATA });
    renderInstances();
    expect(document.querySelectorAll('.inst-card:not(.add-card)')).toHaveLength(1);
    expect(document.querySelector('.add-card')).toBeTruthy();
  });

  it('shows section status with counts present / dash absent', () => {
    addInstance({ label: 'dev1', data: PLUGIN_DATA });
    renderInstances();
    const rows = [...document.querySelectorAll('.ic-sec')].map(r => [
      r.querySelector('.ic-sec-label').textContent,
      r.querySelector('.ic-sec-val').textContent,
      r.classList.contains('absent'),
    ]);
    const byLabel = Object.fromEntries(rows.map(([l, v, a]) => [l, { v, a }]));
    expect(byLabel['Plugins']).toEqual({ v: '2', a: false });
    expect(byLabel['Custom apps'].a).toBe(true); // absent
    expect(byLabel['Custom apps'].v).toBe('—');
  });

  it('renders the title from the instance label', () => {
    addInstance({ label: 'Prod', data: SCHEMA_DATA });
    renderInstances();
    expect(document.querySelector('.ic-title').textContent).toBe('Prod');
  });

  it('renders a disambiguating subtitle (build · export date) when metadata is present', () => {
    addInstance({
      label: 'dev1',
      data: SCHEMA_DATA,
      meta: {
        instance_name: 'dev1',
        build_name: 'Washington',
        exported_at: '2026-06-20T10:00:00Z',
      },
    });
    renderInstances();
    const sub = document.querySelector('.ic-sub');
    expect(sub).toBeTruthy();
    expect(sub.textContent).toContain('Washington');
    // The date portion is locale-formatted; just assert the build joined with it.
    expect(sub.textContent).toContain('·');
  });

  it('omits the subtitle when no useful metadata is present', () => {
    addInstance({ label: 'dev1', data: { nodes: [{ id: 'task' }], edges: [] }, meta: {} });
    renderInstances();
    expect(document.querySelector('.ic-sub')).toBeNull();
  });
});

describe('instanceSubtitle()', () => {
  it('joins build and a parsed export timestamp', () => {
    const out = instanceSubtitle({ build_name: 'Xanadu', exported_at: '2026-01-02T03:04:05Z' });
    expect(out.startsWith('Xanadu · ')).toBe(true);
  });

  it('handles a GlideDateTime-style string from the background exporter', () => {
    const out = instanceSubtitle({ exported_at: '2026-06-20 14:32:01' });
    expect(out).not.toBe('');
  });

  it('falls back to the raw string for an unparseable timestamp', () => {
    expect(instanceSubtitle({ exported_at: 'not-a-date' })).toBe('not-a-date');
  });

  it('returns empty for missing / non-object meta', () => {
    expect(instanceSubtitle(null)).toBe('');
    expect(instanceSubtitle({})).toBe('');
    expect(instanceSubtitle('nope')).toBe('');
  });
});

describe('inline rename', () => {
  it('swaps the title for an input and commits on Enter', () => {
    const e = addInstance({ label: 'old', data: SCHEMA_DATA });
    renderInstances();
    document.querySelector(`.inst-card[data-instance="${e.id}"] .ic-rename`).click();
    const input = document.querySelector('.ic-title-edit');
    expect(input).toBeTruthy();
    input.value = 'renamed';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(getInstance(e.id).label).toBe('renamed');
  });

  it('cancels on Escape, leaving the label unchanged', () => {
    const e = addInstance({ label: 'keep', data: SCHEMA_DATA });
    renderInstances();
    document.querySelector(`.inst-card[data-instance="${e.id}"] .ic-rename`).click();
    const input = document.querySelector('.ic-title-edit');
    input.value = 'discarded';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(getInstance(e.id).label).toBe('keep');
  });

  it('ignores an empty name', () => {
    const e = addInstance({ label: 'stays', data: SCHEMA_DATA });
    renderInstances();
    document.querySelector(`.inst-card[data-instance="${e.id}"] .ic-rename`).click();
    const input = document.querySelector('.ic-title-edit');
    input.value = '   ';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(getInstance(e.id).label).toBe('stays');
  });
});

describe('applyBgConfig()', () => {
  const SAMPLE = [
    'var CONFIG = {',
    "  format: 'json', // 'json' | 'markdown' | 'jsonld'",
    "  edgeTypes: ['reference', 'extends', 'm2m', 'rel', 'view', 'cmdb_rel'],",
    '  printToScriptOutput: false,',
    '  includeRecordCounts: false,',
    '  metadataSections: [], // e.g. ["plugins"]',
    '  includePropertyValues: false,',
    '  maxFieldsPerTable: 0,',
    '};',
    '',
    "gs.print('done');",
  ].join('\n');

  it('rewrites scalar, boolean and array fields in place', () => {
    const out = applyBgConfig(SAMPLE, {
      format: 'markdown',
      includeRecordCounts: true,
      printToScriptOutput: true,
      includePropertyValues: false,
      metadataSections: ['plugins', 'storeApps'],
      edgeTypes: ['reference', 'm2m'],
    });
    expect(out).toContain("format: 'markdown',");
    expect(out).toContain('includeRecordCounts: true,');
    expect(out).toContain('printToScriptOutput: true,');
    expect(out).toContain("metadataSections: ['plugins', 'storeApps'],");
    expect(out).toContain("edgeTypes: ['reference', 'm2m'],");
    // Untouched code outside the block survives.
    expect(out).toContain("gs.print('done');");
  });

  it('empties an array field when no values are selected', () => {
    const out = applyBgConfig(SAMPLE, { metadataSections: [], edgeTypes: [] });
    expect(out).toContain('metadataSections: [],');
    expect(out).toContain('edgeTypes: [],');
  });

  it('preserves the trailing comment on a rewritten line', () => {
    const out = applyBgConfig(SAMPLE, { format: 'jsonld' });
    expect(out).toContain("format: 'jsonld', // 'json' | 'markdown' | 'jsonld'");
  });

  it('returns the source unchanged when no CONFIG block is present', () => {
    const src = 'var x = 1;\n';
    expect(applyBgConfig(src, { format: 'markdown' })).toBe(src);
  });

  it('applies cleanly to the real background-exporter source (drift guard)', () => {
    const bgPath = resolve(process.cwd(), 'src/exporters/background/sn-schema-export.bg.js');
    const src = readFileSync(bgPath, 'utf8');
    const out = applyBgConfig(src, {
      format: 'markdown',
      includeRecordCounts: true,
      metadataSections: ['plugins'],
      edgeTypes: ['reference'],
    });
    expect(out).toContain("format: 'markdown'");
    expect(out).toContain('includeRecordCounts: true');
    expect(out).toContain("metadataSections: ['plugins']");
    expect(out).toContain("edgeTypes: ['reference']");
    // The dynamic, non-configured lines must be left intact.
    expect(out).toContain('attachmentTargetSysId: gs.getUserID()');
  });
});

describe('per-instance tool icons', () => {
  it('renders a tool icon on each card; registration is idempotent', () => {
    registerTool({ key: 't1', label: 'Tool One', icon: '◎' });
    registerTool({ key: 't1', label: 'dup' }); // ignored
    addInstance({ label: 'a', data: SCHEMA_DATA });
    renderInstances();
    expect(document.querySelectorAll('[data-tool="t1"]')).toHaveLength(1);
  });

  it('enables the icon only on cards whose instance satisfies requires', () => {
    registerTool({
      key: 'cmp',
      label: 'Compare',
      icon: '⇄',
      requires: ['plugins'],
      enter: vi.fn(),
    });
    const schemaOnly = addInstance({ label: 'a', data: SCHEMA_DATA });
    const withPlugins = addInstance({ label: 'b', data: PLUGIN_DATA });
    refreshLanding();
    expect(cardTool(schemaOnly.id, 'cmp').disabled).toBe(true);
    expect(cardTool(withPlugins.id, 'cmp').disabled).toBe(false);
  });

  it('clicking an enabled icon launches the tool with that instance id', () => {
    const enter = vi.fn();
    registerTool({ key: 'se', label: 'SE', icon: '◎', requires: ['schema'], enter });
    const a = addInstance({ label: 'a', data: SCHEMA_DATA });
    const b = addInstance({ label: 'b', data: SCHEMA_DATA });
    refreshLanding();
    cardTool(b.id, 'se').click();
    expect(enter).toHaveBeenCalledWith(b.id);
    expect(a.id).not.toBe(b.id);
  });

  it('clicking a disabled icon does nothing', () => {
    const enter = vi.fn();
    registerTool({ key: 'cmp', label: 'Compare', icon: '⇄', requires: ['plugins'], enter });
    const a = addInstance({ label: 'a', data: SCHEMA_DATA }); // no plugins
    refreshLanding();
    cardTool(a.id, 'cmp').click();
    expect(enter).not.toHaveBeenCalled();
  });

  it('minInstances gates the icon until enough eligible instances exist', () => {
    registerTool({ key: 'diff', label: 'Diff', icon: '⇄', requires: ['schema'], minInstances: 2 });
    const a = addInstance({ label: 'a', data: SCHEMA_DATA });
    refreshLanding();
    expect(cardTool(a.id, 'diff').disabled).toBe(true); // only 1 instance
    const b = addInstance({ label: 'b', data: SCHEMA_DATA });
    refreshLanding();
    expect(cardTool(a.id, 'diff').disabled).toBe(false); // now 2
    expect(cardTool(b.id, 'diff').disabled).toBe(false);
  });

  it('an enabled() predicate can disable the icon (e.g. a Settings feature off)', () => {
    let featureOn = false;
    registerTool({
      key: 'gated',
      label: 'Gated',
      icon: '⚑',
      requires: ['schema'],
      enabled: () => featureOn,
    });
    const a = addInstance({ label: 'a', data: SCHEMA_DATA });
    refreshLanding();
    expect(cardTool(a.id, 'gated').disabled).toBe(true);
    featureOn = true;
    refreshLanding();
    expect(cardTool(a.id, 'gated').disabled).toBe(false);
  });
});

describe('initLanding (built-in Schema Explorer + add card)', () => {
  it('wires the demo button to register + select an instance', () => {
    initLanding();
    document.getElementById('btn-demo').click();
    expect(document.querySelectorAll('.inst-card:not(.add-card)').length).toBe(1);
  });

  it('opens the selected instance in Schema Explorer from its card icon', () => {
    initLanding();
    document.getElementById('btn-demo').click();
    const tile = document.querySelector('[data-tool="schemaExplorer"]');
    expect(tile).toBeTruthy();
    expect(tile.disabled).toBe(false);
    tile.click();
    expect(selectInstanceForGraph).toHaveBeenCalledTimes(1);
    expect(setWorkspace).toHaveBeenCalledWith('schema-explorer');
  });

  it('Home button switches back to the landing workspace', () => {
    initLanding();
    document.getElementById('btn-home').click();
    expect(setWorkspace).toHaveBeenCalledWith('landing');
  });
});
