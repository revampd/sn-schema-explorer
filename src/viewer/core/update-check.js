import { Settings } from '../modules/settings/index.js';
import { h } from './template.js';

// Optional, privacy-respecting update check (#45). Once per browser session, and
// only if the user hasn't turned it off, fetch the latest GitHub release and show
// a dismissible footer badge when it's newer than this build. The only network
// call is a single GET to the public releases API — no telemetry. Any failure
// (offline, CORS, timeout, non-200) is swallowed silently.

const REPO = 'revampd/sn-schema-explorer';
const RELEASES_API = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;
const SESSION_FLAG = 'snse:updateChecked';

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

function _localVersion() {
  // Replaced at build time via esbuild `define`; `typeof` guards the dev/test
  // case where the identifier isn't defined (no ReferenceError).
  return typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';
}

function _showBadge(tag) {
  const footer = document.querySelector('footer');
  if (!footer || document.getElementById('update-badge')) return;
  const badge = h(
    'span',
    { id: 'update-badge', class: 'update-badge' },
    h(
      'a',
      { href: RELEASES_PAGE, target: '_blank', rel: 'noopener', class: 'update-badge-link' },
      `Update available: ${tag}`
    ),
    h(
      'button',
      { class: 'update-badge-close', title: 'Dismiss', onClick: () => badge.remove() },
      '×'
    )
  );
  footer.appendChild(badge);
}

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
    if (tag && isNewerVersion(tag, _localVersion())) _showBadge(tag);
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
