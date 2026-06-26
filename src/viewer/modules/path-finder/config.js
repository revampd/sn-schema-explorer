/**
 * Path Finder advanced-config panel — extracted from path-finder/index.js (#73).
 *
 * Owns the `advancedPathFinder` tuning (min/max steps, max results): localStorage
 * persistence, the sidebar Configuration panel's show/hide + input wiring. The
 * search core reads the current values via getPfConfig(); behaviour-preserving.
 */
import { Settings } from '../settings/index.js';

const PF_CONFIG_KEY = 'snse:pfConfig:v1';
const PF_CONFIG_DEFAULTS = { minSteps: 1, maxSteps: 10, maxResults: 5 };

function pfLoadConfig() {
  try {
    const raw = localStorage.getItem(PF_CONFIG_KEY);
    if (!raw) return { ...PF_CONFIG_DEFAULTS };
    const obj = JSON.parse(raw);
    return {
      minSteps: Math.max(1, Math.min(50, +obj.minSteps || PF_CONFIG_DEFAULTS.minSteps)),
      maxSteps: Math.max(1, Math.min(50, +obj.maxSteps || PF_CONFIG_DEFAULTS.maxSteps)),
      maxResults: Math.max(1, Math.min(20, +obj.maxResults || PF_CONFIG_DEFAULTS.maxResults)),
    };
  } catch (e) {
    return { ...PF_CONFIG_DEFAULTS };
  }
}

let _pfConfig = pfLoadConfig();

/** Current Path Finder config (live reference — read at search time). */
export function getPfConfig() {
  return _pfConfig;
}

function pfSaveConfig() {
  try {
    localStorage.setItem(PF_CONFIG_KEY, JSON.stringify(_pfConfig));
  } catch (e) {
    console.warn('PathFinder: localStorage write failed', e);
  }
}

function pfConfigPopulateInputs() {
  const min = document.getElementById('pf-cfg-min');
  const max = document.getElementById('pf-cfg-max');
  const res = document.getElementById('pf-cfg-results');
  if (min) min.value = _pfConfig.minSteps;
  if (max) max.value = _pfConfig.maxSteps;
  if (res) res.value = _pfConfig.maxResults;
}

export function pfConfigSyncVisibility() {
  const section = document.getElementById('pf-config-section');
  if (!section) return;
  const enabled = Settings.isEnabled('advancedPathFinder');
  section.style.display = enabled ? '' : 'none';
  if (enabled) pfConfigPopulateInputs();
}

/**
 * Wire the config inputs and reset button.
 * @param {object} opts
 * @param {() => void} opts.onApply called after the config changes so the caller
 *   can re-run the current search (only when results are already showing).
 */
export function pfConfigWireInputs({ onApply } = {}) {
  const min = document.getElementById('pf-cfg-min');
  const max = document.getElementById('pf-cfg-max');
  const res = document.getElementById('pf-cfg-results');
  const reset = document.getElementById('pf-config-reset');
  const apply = () => {
    let mn = Math.max(1, Math.min(50, parseInt(min.value, 10) || 1));
    let mx = Math.max(1, Math.min(50, parseInt(max.value, 10) || 10));
    let rs = Math.max(1, Math.min(20, parseInt(res.value, 10) || 5));
    if (mn > mx) {
      if (document.activeElement === min) mx = mn;
      else mn = mx;
    }
    _pfConfig = { minSteps: mn, maxSteps: mx, maxResults: rs };
    pfSaveConfig();
    pfConfigPopulateInputs();
    if (onApply) onApply();
  };
  if (min) min.addEventListener('change', apply);
  if (max) max.addEventListener('change', apply);
  if (res) res.addEventListener('change', apply);
  if (reset)
    reset.addEventListener('click', () => {
      _pfConfig = { ...PF_CONFIG_DEFAULTS };
      pfSaveConfig();
      pfConfigPopulateInputs();
      if (onApply) onApply();
    });
}
