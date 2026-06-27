/* ============================================================================
 * workspace.js — top-level workspace controller (v1.0.3)
 * ============================================================================
 *
 * A "workspace" selects which top-level tool is on screen. It is a SIBLING of
 * view-mode, NOT a fourth view-mode: `setViewMode` (engine/view-mode.js) keeps
 * hard-validating `force|path|diff` and is left 100% intact. The Schema
 * Explorer workspace owns those graph sub-modes; other workspaces (the landing
 * page, Instance Comparison) are separate regions.
 *
 *   workspaces: 'landing' | 'schema-explorer' | 'instance-comparison'
 *
 * Mechanism: each non-baseline workspace registers a root element. Switching
 * sets `uiState.workspace`, stamps `body[data-workspace]`, and toggles the
 * `workspace-active` class on each registered root (CSS shows only the active
 * one — see styles/workspace.css). The Schema Explorer chrome is the baseline
 * (visible by default), so with the default workspace nothing is hidden and the
 * app looks exactly as before. Later PRs add the landing/comparison regions and
 * flip the default.
 * ============================================================================ */

import { uiState } from '../core/state.js';

export const WORKSPACES = ['landing', 'schema-explorer', 'instance-comparison'];

const _workspaces = new Map(); // key -> { key, root: Element|null }
const _listeners = []; // (workspace, prevWorkspace) => void

/**
 * Register a workspace and (optionally) the root element it shows/hides.
 * `root` may be an Element or a selector string; a workspace with no root
 * (e.g. 'schema-explorer', whose chrome is the baseline) is still registered so
 * setWorkspace can track it and fire listeners.
 */
export function registerWorkspace({ key, root = null } = {}) {
  if (!WORKSPACES.includes(key)) return;
  let el = null;
  if (typeof root === 'string') el = document.querySelector(root);
  else if (root) el = root;
  _workspaces.set(key, { key, root: el });
}

export function onWorkspaceChange(fn) {
  _listeners.push(fn);
}

export function getWorkspace() {
  return uiState.workspace;
}

/**
 * Switch the active workspace. Ignores unknown keys. Toggles region visibility
 * and notifies listeners only when the workspace actually changed.
 */
export function setWorkspace(key) {
  if (!WORKSPACES.includes(key)) return;
  const prev = uiState.workspace;
  uiState.workspace = key;

  if (typeof document !== 'undefined' && document.body) {
    document.body.dataset.workspace = key;
  }
  _workspaces.forEach(ws => {
    if (ws.root) ws.root.classList.toggle('workspace-active', ws.key === key);
  });

  if (key !== prev) _listeners.forEach(fn => fn(key, prev));
}

/**
 * Wire the built-in workspace regions and apply the default. Called once at
 * startup from entries/*. Registers the landing + instance-comparison regions
 * (their modules populate the contents in later PRs) and the schema-explorer
 * baseline (no root — it's the default chrome), then activates the current
 * uiState.workspace so `body[data-workspace]` is stamped from the first paint.
 */
export function initWorkspaces() {
  registerWorkspace({ key: 'schema-explorer' });
  registerWorkspace({ key: 'landing', root: '#landing-root' });
  registerWorkspace({ key: 'instance-comparison', root: '#instance-compare' });
  setWorkspace(uiState.workspace);
}
