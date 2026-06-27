import { Settings } from '../modules/settings/index.js';
import { h } from './template.js';

// Optional, privacy-respecting update check (#45). Once per browser session, and
// only if the user hasn't turned it off, fetch the latest GitHub release and show
// a chip state change when it's newer than this build. No telemetry; any failure
// (offline, CORS, timeout, non-200) is swallowed silently.

const REPO = 'revampd/sn-schema-explorer';
const RELEASES_API = `https://api.github.com/repos/${REPO}/releases/latest`;
export const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;
export const GITHUB_PAGE = `https://github.com/${REPO}`;
const SESSION_FLAG = 'snse:updateChecked';

// Module-level update state — set once when the check resolves.
let _updateTag = null; // e.g. 'v1.2.3' when a newer release exists, else null

export function getUpdateTag() {
  return _updateTag;
}

// Pure semver compare — true when `remote` is strictly newer than `local`.
// Tolerates a leading "v" and missing minor/patch; returns false for anything
// non-numeric so a malformed tag never nags the user.
export function isNewerVersion(remote, local) {
  const parse = v =>
    String(v || '')
      .trim()
      .replace(/^v/i, '')
      .split('.')
      .slice(0, 3)
      .map(n => parseInt(n, 10));
  const a = parse(remote);
  const b = parse(local);
  if (!a.length || !b.length || a.some(Number.isNaN) || b.some(Number.isNaN)) return false;
  for (let i = 0; i < 3; i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

export function localVersion() {
  // Replaced at build time via esbuild `define`; `typeof` guards the dev/test
  // case where the identifier isn't defined (no ReferenceError).
  return typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';
}

function _applyUpdateState(tag) {
  _updateTag = tag;
  const chip = document.getElementById('about-chip');
  if (!chip) return;
  chip.classList.add('has-update');
  chip.textContent = 'New version available';
}

// ── About modal ────────────────────────────────────────────────────────────

function _buildAboutBody() {
  const ver = localVersion();
  const year = new Date().getFullYear();

  const updateRow = _updateTag
    ? h(
        'div',
        { class: 'about-update about-update-new' },
        `Update available: `,
        h(
          'a',
          { href: RELEASES_PAGE, target: '_blank', rel: 'noopener' },
          _updateTag
        )
      )
    : h('div', { class: 'about-update' }, 'No updates available');

  return h(
    'div',
    {},
    h(
      'div',
      { class: 'about-row' },
      h('span', { class: 'about-label' }, 'Version'),
      h('span', { class: 'about-value about-mono' }, `v${ver}`)
    ),
    h(
      'div',
      { class: 'about-row' },
      h('span', { class: 'about-label' }, 'Updates'),
      updateRow
    ),
    h('div', { class: 'about-sep' }),
    h(
      'div',
      { class: 'about-row' },
      h('span', { class: 'about-label' }, 'Source'),
      h(
        'a',
        { href: GITHUB_PAGE, target: '_blank', rel: 'noopener', class: 'about-link' },
        'github.com/revampd/sn-schema-explorer'
      )
    ),
    h(
      'div',
      { class: 'about-row' },
      h('span', { class: 'about-label' }, 'Built with'),
      h('span', { class: 'about-value' }, 'Claude by Anthropic')
    ),
    h(
      'div',
      { class: 'about-row' },
      h('span', { class: 'about-label' }, 'License'),
      h('span', { class: 'about-value' }, `MIT © ${year} revampd`)
    )
  );
}

function _openAbout() {
  const overlay = document.getElementById('about-overlay');
  const body = document.getElementById('about-body');
  if (!overlay || !body) return;
  body.textContent = '';
  body.appendChild(_buildAboutBody());
  overlay.classList.add('is-open');
}

function _closeAbout() {
  document.getElementById('about-overlay')?.classList.remove('is-open');
}

export function initAbout() {
  const chip = document.getElementById('about-chip');
  chip?.addEventListener('click', _openAbout);

  const closeBtn = document.getElementById('about-close');
  closeBtn?.addEventListener('click', _closeAbout);

  document.getElementById('about-overlay')?.addEventListener('click', ev => {
    if (ev.target === ev.currentTarget) _closeAbout();
  });
}

// ── Update check ───────────────────────────────────────────────────────────

async function _run() {
  if (typeof fetch !== 'function') return;
  try {
    const res = await fetch(RELEASES_API, {
      cache: 'no-store',
      signal: AbortSignal.timeout?.(5000),
    });
    if (!res.ok) return;
    const data = await res.json();
    const tag = data && data.tag_name;
    if (tag && isNewerVersion(tag, localVersion())) _applyUpdateState(tag);
  } catch {
    /* offline / CORS / timeout / parse — degrade silently */
  }
}

export function initUpdateCheck() {
  if (Settings.isEnabled && !Settings.isEnabled('checkUpdates')) return;
  // Once per session — a reload shouldn't re-fire the badge.
  try {
    if (sessionStorage.getItem(SESSION_FLAG)) return;
    sessionStorage.setItem(SESSION_FLAG, '1');
  } catch {
    /* sessionStorage unavailable — proceed without the guard */
  }
  // Defer so the check never competes with the initial render.
  setTimeout(_run, 5000);
}
