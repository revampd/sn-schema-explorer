/**
 * @vitest-environment jsdom
 *
 * Unit tests for src/viewer/modules/schema-diff/file-input.js — the diff
 * sidebar drop-zone + multipart-manifest loader extracted from schema-diff
 * in PR for #73. Behaviour-preserving safety net: verifies single-file load,
 * multi-part manifest stitching, validation failures, and the clear button.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// engine/render.js drags in d3/canvas machinery that is irrelevant here and
// has import-time side effects — stub it so we exercise only the wiring.
vi.mock('../../src/viewer/engine/render.js', () => ({
  render: vi.fn(),
  updateInstancePill: vi.fn(),
}));

import { initDiffFileInput } from '../../src/viewer/modules/schema-diff/file-input.js';
import { diffState, uiState } from '../../src/viewer/core/state.js';

// A FileReader-compatible stub backed by a synchronous text payload.
function fakeFile(name, text) {
  return { name, text: () => Promise.resolve(text) };
}

function setupDom() {
  document.body.innerHTML = `
    <div id="diff-drop-zone">
      <div class="diff-drop-zone-hint">or tap to browse</div>
    </div>
    <input type="file" id="diff-file-input" accept=".json" />
    <button id="diff-drop-clear" style="display:none"></button>
    <div id="diff-dz-text">Drop compare schema here</div>
    <div id="diff-dz-filename" style="display:none"></div>
    <div id="diff-mode-warn"></div>
  `;
}

function fireChange(inp, files) {
  Object.defineProperty(inp, 'files', { value: files, configurable: true });
  inp.dispatchEvent(new Event('change'));
}

const VALID_SCHEMA = { nodes: [{ id: 'task' }], edges: [] };

let deps;
beforeEach(() => {
  setupDom();
  global.alert = vi.fn();
  global.confirm = vi.fn(() => true);
  // jsdom lacks a usable FileReader for our fake files — provide one that reads
  // the stub's text payload.
  global.FileReader = class {
    readAsText(f) {
      Promise.resolve(f._text).then(t => this.onload({ target: { result: t } }));
    }
  };
  diffState._diffData = { dummy: true };
  uiState._viewPositionCache = { diff: { x: 1 } };
  deps = {
    loadDiffSchema: vi.fn(),
    diffUngraftAddedFromBase: vi.fn(),
    diffUpdateSummary: vi.fn(),
    diffBuildList: vi.fn(),
  };
});

describe('initDiffFileInput — guards', () => {
  it('no-ops when the drop-zone is absent', () => {
    document.body.innerHTML = '';
    expect(() => initDiffFileInput(deps)).not.toThrow();
  });

  it('marks the input multiple and rewrites the hint', () => {
    initDiffFileInput(deps);
    expect(document.getElementById('diff-file-input').hasAttribute('multiple')).toBe(true);
    expect(document.querySelector('.diff-drop-zone-hint').innerHTML).toContain('manifest');
  });
});

describe('initDiffFileInput — single file', () => {
  it('loads a valid schema and shows the filename', async () => {
    initDiffFileInput(deps);
    const inp = document.getElementById('diff-file-input');
    const files = [{ name: 'compare.json', _text: JSON.stringify(VALID_SCHEMA) }];
    files.length = 1;
    fireChange(inp, files);
    await Promise.resolve();
    await Promise.resolve();
    expect(deps.loadDiffSchema).toHaveBeenCalledWith(VALID_SCHEMA);
    expect(document.getElementById('diff-dz-filename').textContent).toBe('compare.json');
    expect(document.getElementById('diff-drop-clear').style.display).toBe('');
  });

  it('rejects JSON missing nodes/edges', async () => {
    initDiffFileInput(deps);
    const inp = document.getElementById('diff-file-input');
    const files = [{ name: 'bad.json', _text: JSON.stringify({ foo: 1 }) }];
    files.length = 1;
    fireChange(inp, files);
    await Promise.resolve();
    await Promise.resolve();
    expect(deps.loadDiffSchema).not.toHaveBeenCalled();
    expect(global.alert).toHaveBeenCalled();
  });
});

describe('initDiffFileInput — multipart manifest', () => {
  it('stitches part files named by the manifest in idx order', async () => {
    initDiffFileInput(deps);
    const inp = document.getElementById('diff-file-input');
    const whole = JSON.stringify(VALID_SCHEMA);
    const half = Math.ceil(whole.length / 2);
    const manifest = {
      name: 'x.manifest.json',
      _text: JSON.stringify({
        _manifest_version: 1,
        parts: [
          { fileName: 'x.part1.json', idx: 0 },
          { fileName: 'x.part2.json', idx: 1 },
        ],
      }),
    };
    manifest.text = () => Promise.resolve(manifest._text);
    const p1 = fakeFile('x.part1.json', whole.slice(0, half));
    const p2 = fakeFile('x.part2.json', whole.slice(half));
    const files = [manifest, p1, p2];
    fireChange(inp, files);
    await new Promise(r => setTimeout(r, 0));
    expect(deps.loadDiffSchema).toHaveBeenCalledWith(VALID_SCHEMA);
  });

  it('reports missing part files', async () => {
    initDiffFileInput(deps);
    const inp = document.getElementById('diff-file-input');
    const manifest = fakeFile(
      'x.manifest.json',
      JSON.stringify({ _manifest_version: 1, parts: [{ fileName: 'x.part1.json', idx: 0 }] })
    );
    const files = [manifest];
    files.push(fakeFile('unrelated.json', '{}'));
    fireChange(inp, files);
    await new Promise(r => setTimeout(r, 0));
    expect(deps.loadDiffSchema).not.toHaveBeenCalled();
    expect(global.alert).toHaveBeenCalled();
  });
});

describe('initDiffFileInput — clear button', () => {
  it('resets diff state and DOM', () => {
    initDiffFileInput(deps);
    const clearBtn = document.getElementById('diff-drop-clear');
    clearBtn.style.display = '';
    clearBtn.click();
    expect(deps.diffUngraftAddedFromBase).toHaveBeenCalled();
    expect(diffState._diffData).toBe(null);
    expect(diffState._diffFilter).toBe('all');
    expect(uiState._viewPositionCache.diff).toBe(null);
    expect(deps.diffUpdateSummary).toHaveBeenCalled();
    expect(deps.diffBuildList).toHaveBeenCalled();
    expect(document.getElementById('diff-dz-text').textContent).toBe('Drop compare schema here');
    expect(clearBtn.style.display).toBe('none');
  });
});
