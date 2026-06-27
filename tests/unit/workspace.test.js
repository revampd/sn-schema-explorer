/**
 * @vitest-environment jsdom
 *
 * Unit tests for src/viewer/engine/workspace.js — the top-level workspace
 * controller (#100). A sibling of view-mode, not a 4th mode. Verifies the
 * registry/toggle mechanism, body[data-workspace] stamping, change listeners,
 * and that the default keeps the app on 'schema-explorer' with regions hidden.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  WORKSPACES,
  registerWorkspace,
  setWorkspace,
  getWorkspace,
  onWorkspaceChange,
  initWorkspaces,
} from '../../src/viewer/engine/workspace.js';
import { uiState } from '../../src/viewer/core/state.js';

function setupDom() {
  document.body.innerHTML = `
    <div id="canvas"></div>
    <div id="landing-root" class="workspace-region"></div>
    <div id="instance-compare" class="workspace-region"></div>
  `;
  delete document.body.dataset.workspace;
}

beforeEach(() => {
  setupDom();
  uiState.workspace = 'schema-explorer';
});

describe('constants', () => {
  it('exposes the three workspaces', () => {
    expect(WORKSPACES).toEqual(['landing', 'schema-explorer', 'instance-comparison']);
  });
});

describe('setWorkspace', () => {
  it('updates uiState + stamps body[data-workspace]', () => {
    registerWorkspace({ key: 'landing', root: '#landing-root' });
    setWorkspace('landing');
    expect(getWorkspace()).toBe('landing');
    expect(uiState.workspace).toBe('landing');
    expect(document.body.dataset.workspace).toBe('landing');
  });

  it('toggles workspace-active only on the active region', () => {
    registerWorkspace({ key: 'landing', root: '#landing-root' });
    registerWorkspace({ key: 'instance-comparison', root: '#instance-compare' });
    const landing = document.getElementById('landing-root');
    const compare = document.getElementById('instance-compare');

    setWorkspace('landing');
    expect(landing.classList.contains('workspace-active')).toBe(true);
    expect(compare.classList.contains('workspace-active')).toBe(false);

    setWorkspace('instance-comparison');
    expect(landing.classList.contains('workspace-active')).toBe(false);
    expect(compare.classList.contains('workspace-active')).toBe(true);
  });

  it('ignores unknown workspace keys', () => {
    setWorkspace('bogus');
    expect(getWorkspace()).toBe('schema-explorer');
    expect(document.body.dataset.workspace).toBeUndefined();
  });

  it('accepts an Element as root (not just a selector)', () => {
    const el = document.getElementById('landing-root');
    registerWorkspace({ key: 'landing', root: el });
    setWorkspace('landing');
    expect(el.classList.contains('workspace-active')).toBe(true);
  });
});

describe('onWorkspaceChange', () => {
  it('fires with (next, prev) only on an actual change', () => {
    registerWorkspace({ key: 'landing', root: '#landing-root' });
    const calls = [];
    onWorkspaceChange((next, prev) => calls.push([next, prev]));

    setWorkspace('landing'); // schema-explorer -> landing
    setWorkspace('landing'); // no change
    setWorkspace('schema-explorer'); // landing -> schema-explorer

    expect(calls).toEqual([
      ['landing', 'schema-explorer'],
      ['schema-explorer', 'landing'],
    ]);
  });
});

describe('initWorkspaces', () => {
  it('registers regions and applies the default (schema-explorer, regions hidden)', () => {
    initWorkspaces();
    expect(getWorkspace()).toBe('schema-explorer');
    expect(document.body.dataset.workspace).toBe('schema-explorer');
    // Neither region is activated under the default workspace.
    expect(document.getElementById('landing-root').classList.contains('workspace-active')).toBe(
      false
    );
    expect(document.getElementById('instance-compare').classList.contains('workspace-active')).toBe(
      false
    );
  });
});
