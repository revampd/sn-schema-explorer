/**
 * @vitest-environment jsdom
 *
 * Unit tests for src/core/tool-switcher.js (#127) — the header tool switcher
 * registry + render. Tools self-register; the switcher renders enabled ones,
 * highlights the active one, activates on click, and hides on the landing.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { registerSwitcherTool, renderToolSwitcher } from '../../../src/core/tool-switcher.js';
import { setWorkspace } from '../../../src/core/workspace.js';

// Module-level registry persists across tests, so register a known set once and
// drive visibility/active purely through the flags below.
const flags = { mapOn: true, pathOn: false, active: 'map', activated: [] };
let registered = false;
function ensureTools() {
  if (registered) return;
  registered = true;
  registerSwitcherTool({
    key: 'map',
    label: 'Schema Map',
    icon: '◎',
    order: 10,
    enabled: () => flags.mapOn,
    isActive: () => flags.active === 'map',
    activate: () => flags.activated.push('map'),
  });
  registerSwitcherTool({
    key: 'path',
    label: 'Path Finder',
    icon: '⤳',
    order: 20,
    enabled: () => flags.pathOn,
    isActive: () => flags.active === 'path',
    activate: () => flags.activated.push('path'),
  });
}

beforeEach(() => {
  document.body.innerHTML = '<div id="tool-switcher"></div>';
  ensureTools();
  flags.mapOn = true;
  flags.pathOn = false;
  flags.active = 'map';
  flags.activated = [];
  setWorkspace('schema-explorer');
});

const host = () => document.getElementById('tool-switcher');
const btns = () => [...host().querySelectorAll('.ts-btn')];

describe('renderToolSwitcher', () => {
  it('renders only enabled tools, in order, with icon + label', () => {
    renderToolSwitcher();
    expect(btns().map(b => b.dataset.tool)).toEqual(['map']); // path disabled
    flags.pathOn = true;
    renderToolSwitcher();
    expect(btns().map(b => b.dataset.tool)).toEqual(['map', 'path']);
    expect(btns()[0].querySelector('.ts-icon').textContent).toBe('◎');
    expect(btns()[0].querySelector('.ts-label').textContent).toBe('Schema Map');
  });

  it('marks the active tool and sets aria-current', () => {
    flags.pathOn = true;
    flags.active = 'path';
    renderToolSwitcher();
    const path = host().querySelector('.ts-btn[data-tool="path"]');
    expect(path.classList.contains('active')).toBe(true);
    expect(path.getAttribute('aria-current')).toBe('true');
    expect(host().querySelector('.ts-btn[data-tool="map"]').classList.contains('active')).toBe(
      false
    );
  });

  it('activates a tool on click, but not the already-active one', () => {
    flags.pathOn = true;
    renderToolSwitcher();
    host().querySelector('.ts-btn[data-tool="map"]').click(); // active → no-op
    host().querySelector('.ts-btn[data-tool="path"]').click(); // activates
    expect(flags.activated).toEqual(['path']);
  });

  it('hides the switcher on the landing workspace', () => {
    setWorkspace('landing');
    renderToolSwitcher();
    expect(host().style.display).toBe('none');
    setWorkspace('schema-explorer');
    renderToolSwitcher();
    expect(host().style.display).toBe('');
  });

  it('hides the switcher when no tool is enabled', () => {
    flags.mapOn = false;
    flags.pathOn = false;
    renderToolSwitcher();
    expect(host().style.display).toBe('none');
    expect(btns()).toHaveLength(0);
  });
});
