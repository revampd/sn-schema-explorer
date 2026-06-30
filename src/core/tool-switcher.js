/* ============================================================================
 * core/tool-switcher.js — header tool switcher (registry + render)
 * ============================================================================
 * Replaces the old `#view-mode-seg` segment. A compact, always-visible switcher
 * in the header that lets the user move between the per-instance tools — Schema
 * Map, Path Finder, Schema Diff (view-modes of the schema-explorer workspace)
 * and Configuration Data (its own workspace) — without going Home.
 *
 * Tools self-register (mirroring registerFeature/registerWorkspace/registerTool):
 *   registerSwitcherTool({ key, label, icon, order, enabled, isActive, activate, title? })
 *     enabled()  — show this tool in the switcher (capabilities/settings gate)
 *     isActive() — is this the tool currently on screen (highlighted)
 *     activate() — switch to it (set workspace / view-mode)
 *
 * The switcher re-renders on workspace + view-mode changes; callers that change
 * instance availability (load/select, add/remove) call refreshToolSwitcher().
 * Hidden on the landing workspace and whenever no tool is available.
 * ============================================================================ */

import { getWorkspace, onWorkspaceChange } from './workspace.js';

const _tools = [];

export function registerSwitcherTool(tool) {
  if (!tool || !tool.key) return;
  _tools.push({ order: 100, ...tool });
}

export function renderToolSwitcher() {
  const host = document.getElementById('tool-switcher');
  if (!host) return;
  host.textContent = '';

  // The switcher is for in-tool navigation; nothing to switch on the landing.
  if (getWorkspace() === 'landing') {
    host.style.display = 'none';
    return;
  }

  const tools = _tools
    .slice()
    .sort((a, b) => a.order - b.order)
    .filter(t => (t.enabled ? t.enabled() : true));

  if (!tools.length) {
    host.style.display = 'none';
    return;
  }
  host.style.display = '';

  for (const t of tools) {
    const active = !!(t.isActive && t.isActive());
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ts-btn' + (active ? ' active' : '');
    btn.dataset.tool = t.key;
    btn.title = t.title || t.label;
    if (active) btn.setAttribute('aria-current', 'true');
    const icon = document.createElement('span');
    icon.className = 'ts-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = t.icon || '';
    const label = document.createElement('span');
    label.className = 'ts-label';
    label.textContent = t.label;
    btn.append(icon, label);
    btn.addEventListener('click', () => {
      if (!(t.isActive && t.isActive())) t.activate();
    });
    host.appendChild(btn);
  }
}

// Alias for callers outside the workspace/view-mode change hooks (instance
// load/select, add/remove) that affect tool availability.
export const refreshToolSwitcher = renderToolSwitcher;

// View-mode re-render is wired by the app entry (main.js) via onViewModeChange,
// to keep this module free of the view-mode → render → canvas (d3) import chain.
export function initToolSwitcher() {
  onWorkspaceChange(() => renderToolSwitcher());
  renderToolSwitcher();
}
