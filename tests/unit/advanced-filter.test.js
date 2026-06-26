/**
 * Unit tests for src/viewer/core/advanced-filter.js — filterOk / _evalOne.
 *
 * filterOk reads uiState.filterConditions and graphState.graphData.
 * Both are mocked so tests control state directly without DOM or module init.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';
import {
  filterOk,
  countActiveFilters,
  clearAllFilters,
  syncSelectedScopes,
} from '../../src/viewer/core/advanced-filter.js';
import { graphState, uiState } from '../../src/viewer/core/state.js';

vi.mock('../../src/viewer/core/state.js', () => {
  const graphState = {
    graphData: null,
    scopeColorMap: {},
  };
  const uiState = {
    filterConditions: [],
    selectedScopes: new Set(),
  };
  return { graphState, uiState };
});

vi.mock('../../src/viewer/modules/settings/index.js', () => ({
  Settings: {
    isCustomName: vi.fn(id => id.startsWith('u_') || id.startsWith('x_')),
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const _refOutIds = new Set(['incident', 'change_request']);
const _refInIds = new Set(['sys_user']);
const _extOutIds = new Set(['incident']);
const _extInIds = new Set(['task']);
const _m2mIds = new Set(['sys_user_grmember']);
const _relIds = new Set(['cmdb_rel_ci']);
const _viewIds = new Set(['v_task']);
const _cmdbRelIds = new Set(['cmdb_ci_server']);

const TASK_NODE = {
  id: 'task',
  label: 'Task',
  scope: 'global',
  _isView: false,
  fields: [
    { name: 'number', label: 'Number' },
    { name: 'state', label: 'State' },
    { name: 'opened_by', label: 'Opened by' },
    { name: 'u_custom_fld', label: 'Custom Field' },
  ],
};
const VIEW_NODE = { id: 'v_task', label: 'Task View', scope: 'global', _isView: true, fields: [] };
const CUSTOM_NODE = {
  id: 'u_my_table',
  label: 'My Table',
  scope: 'global',
  _isView: false,
  fields: [],
};
const GLOBAL_NODE = {
  id: 'incident',
  label: 'Incident',
  scope: 'global',
  _isView: false,
  fields: [],
};
const SCOPED_NODE = {
  id: 'sn_hr_case',
  label: 'HR Case',
  scope: 'sn_hr_core',
  _isView: false,
  fields: [],
};

beforeEach(() => {
  uiState.filterConditions = [];
  uiState.selectedScopes = new Set();
  graphState.graphData = {
    nodes: [TASK_NODE, VIEW_NODE, CUSTOM_NODE, GLOBAL_NODE, SCOPED_NODE],
    _refOutIds,
    _refInIds,
    _extOutIds,
    _extInIds,
    _m2mIds,
    _relIds,
    _viewIds,
    _cmdbRelIds,
    _cmdbCiIds: new Set(['cmdb_ci', 'cmdb_ci_server']),
  };
});

// ── No conditions ─────────────────────────────────────────────────────────────

describe('no conditions', () => {
  it('passes all nodes when filterConditions is empty', () => {
    expect(filterOk(TASK_NODE)).toBe(true);
    expect(filterOk(VIEW_NODE)).toBe(true);
  });
});

// ── scope condition ───────────────────────────────────────────────────────────

describe('scope condition', () => {
  it('empty values array passes all nodes', () => {
    uiState.filterConditions = [{ type: 'scope', values: [] }];
    expect(filterOk(GLOBAL_NODE)).toBe(true);
    expect(filterOk(SCOPED_NODE)).toBe(true);
  });

  it('single scope value filters correctly', () => {
    uiState.filterConditions = [{ type: 'scope', values: ['global'] }];
    expect(filterOk(GLOBAL_NODE)).toBe(true);
    expect(filterOk(SCOPED_NODE)).toBe(false);
  });

  it('multiple scope values use OR semantics', () => {
    uiState.filterConditions = [{ type: 'scope', values: ['global', 'sn_hr_core'] }];
    expect(filterOk(GLOBAL_NODE)).toBe(true);
    expect(filterOk(SCOPED_NODE)).toBe(true);
  });
});

// ── tableType condition ───────────────────────────────────────────────────────

describe('tableType condition', () => {
  it('regular excludes DB views', () => {
    uiState.filterConditions = [{ type: 'tableType', value: 'regular' }];
    expect(filterOk(TASK_NODE)).toBe(true);
    expect(filterOk(VIEW_NODE)).toBe(false);
  });

  it('views shows only DB view nodes', () => {
    uiState.filterConditions = [{ type: 'tableType', value: 'views' }];
    expect(filterOk(VIEW_NODE)).toBe(true);
    expect(filterOk(TASK_NODE)).toBe(false);
  });

  it('custom matches nodes with custom prefix via Settings.isCustomName', () => {
    uiState.filterConditions = [{ type: 'tableType', value: 'custom' }];
    expect(filterOk(CUSTOM_NODE)).toBe(true);
    expect(filterOk(TASK_NODE)).toBe(false);
  });
});

// ── name condition ────────────────────────────────────────────────────────────

describe('name condition', () => {
  it('startsWith matches prefix in id', () => {
    uiState.filterConditions = [{ type: 'name', operator: 'startsWith', value: 'tas' }];
    expect(filterOk(TASK_NODE)).toBe(true);
    expect(filterOk(GLOBAL_NODE)).toBe(false);
  });

  it('contains matches substring in id', () => {
    uiState.filterConditions = [{ type: 'name', operator: 'contains', value: 'ask' }];
    expect(filterOk(TASK_NODE)).toBe(true);
    expect(filterOk(GLOBAL_NODE)).toBe(false);
  });

  it('contains also matches against label', () => {
    uiState.filterConditions = [{ type: 'name', operator: 'contains', value: 'task' }];
    // TASK_NODE.label = 'Task', TASK_NODE.id = 'task' — both match
    expect(filterOk(TASK_NODE)).toBe(true);
    // VIEW_NODE.label = 'Task View' — matches on label
    expect(filterOk(VIEW_NODE)).toBe(true);
  });

  it('is matches exact id or label (case-insensitive)', () => {
    uiState.filterConditions = [{ type: 'name', operator: 'is', value: 'task' }];
    expect(filterOk(TASK_NODE)).toBe(true);
    expect(filterOk(VIEW_NODE)).toBe(false);
  });

  it('empty value passes everything', () => {
    uiState.filterConditions = [{ type: 'name', operator: 'contains', value: '' }];
    expect(filterOk(TASK_NODE)).toBe(true);
    expect(filterOk(SCOPED_NODE)).toBe(true);
  });
});

// ── hasField condition ────────────────────────────────────────────────────────

describe('hasField condition', () => {
  it('contains matches field name substring', () => {
    uiState.filterConditions = [{ type: 'hasField', operator: 'contains', value: 'opened' }];
    expect(filterOk(TASK_NODE)).toBe(true); // has opened_by
    expect(filterOk(GLOBAL_NODE)).toBe(false); // incident has no fields in fixture
  });

  it('contains also matches field label', () => {
    uiState.filterConditions = [{ type: 'hasField', operator: 'contains', value: 'Opened' }];
    expect(filterOk(TASK_NODE)).toBe(true);
  });

  it('startsWith matches field name prefix', () => {
    uiState.filterConditions = [{ type: 'hasField', operator: 'startsWith', value: 'u_' }];
    expect(filterOk(TASK_NODE)).toBe(true); // has u_custom_fld
    expect(filterOk(GLOBAL_NODE)).toBe(false);
  });

  it('is matches exact field name', () => {
    uiState.filterConditions = [{ type: 'hasField', operator: 'is', value: 'number' }];
    expect(filterOk(TASK_NODE)).toBe(true);
    expect(filterOk(GLOBAL_NODE)).toBe(false);
  });

  it('empty value passes all nodes', () => {
    uiState.filterConditions = [{ type: 'hasField', operator: 'contains', value: '' }];
    expect(filterOk(TASK_NODE)).toBe(true);
    expect(filterOk(VIEW_NODE)).toBe(true);
  });
});

// ── hasEdge condition ─────────────────────────────────────────────────────────

describe('hasEdge condition', () => {
  it('ref-out passes nodes in _refOutIds', () => {
    uiState.filterConditions = [{ type: 'hasEdge', edgeType: 'ref-out' }];
    expect(filterOk(GLOBAL_NODE)).toBe(true); // incident is in _refOutIds
    expect(filterOk(SCOPED_NODE)).toBe(false);
  });

  it('ref-in passes nodes in _refInIds', () => {
    uiState.filterConditions = [{ type: 'hasEdge', edgeType: 'ref-in' }];
    expect(filterOk({ ...TASK_NODE, id: 'sys_user' })).toBe(true);
    expect(filterOk(TASK_NODE)).toBe(false);
  });

  it('view passes nodes in _viewIds', () => {
    uiState.filterConditions = [{ type: 'hasEdge', edgeType: 'view' }];
    expect(filterOk(VIEW_NODE)).toBe(true);
    expect(filterOk(TASK_NODE)).toBe(false);
  });
});

// ── fieldCount condition ──────────────────────────────────────────────────────

describe('fieldCount condition', () => {
  it('min only — excludes nodes with fewer fields', () => {
    uiState.filterConditions = [{ type: 'fieldCount', min: 3, max: null }];
    expect(filterOk(TASK_NODE)).toBe(true); // 4 fields
    expect(filterOk(VIEW_NODE)).toBe(false); // 0 fields
  });

  it('max only — excludes nodes with more fields', () => {
    uiState.filterConditions = [{ type: 'fieldCount', min: null, max: 2 }];
    expect(filterOk(TASK_NODE)).toBe(false); // 4 fields
    expect(filterOk(VIEW_NODE)).toBe(true); // 0 fields
  });

  it('min + max range', () => {
    uiState.filterConditions = [{ type: 'fieldCount', min: 2, max: 5 }];
    expect(filterOk(TASK_NODE)).toBe(true); // 4 fields — in range
    expect(filterOk(VIEW_NODE)).toBe(false); // 0 fields — below min
  });

  it('null bounds pass everything', () => {
    uiState.filterConditions = [{ type: 'fieldCount', min: null, max: null }];
    expect(filterOk(TASK_NODE)).toBe(true);
    expect(filterOk(VIEW_NODE)).toBe(true);
  });
});

// ── isCustom condition ────────────────────────────────────────────────────────

describe('isCustom condition', () => {
  it('passes only nodes whose id starts with a custom prefix', () => {
    uiState.filterConditions = [{ type: 'isCustom' }];
    expect(filterOk(CUSTOM_NODE)).toBe(true);
    expect(filterOk(TASK_NODE)).toBe(false);
  });
});

// ── AND logic (multiple conditions) ──────────────────────────────────────────

describe('AND logic', () => {
  it('both conditions must pass', () => {
    uiState.filterConditions = [
      { type: 'scope', values: ['global'] },
      { type: 'tableType', value: 'regular', connector: 'AND' },
    ];
    expect(filterOk(TASK_NODE)).toBe(true); // global + regular
    expect(filterOk(VIEW_NODE)).toBe(false); // global but is a view
    expect(filterOk(SCOPED_NODE)).toBe(false); // not global
  });
});

// ── OR logic (connector = 'OR') ───────────────────────────────────────────────

describe('OR logic', () => {
  it('node passes if it satisfies either group', () => {
    // (scope=global) OR (tableType=views)
    uiState.filterConditions = [
      { type: 'scope', values: ['sn_hr_core'] },
      { type: 'tableType', value: 'views', connector: 'OR' },
    ];
    expect(filterOk(SCOPED_NODE)).toBe(true); // passes first group
    expect(filterOk(VIEW_NODE)).toBe(true); // passes second group
    expect(filterOk(TASK_NODE)).toBe(false); // fails both
  });
});

// ── Utility exports ───────────────────────────────────────────────────────────

describe('countActiveFilters', () => {
  it('returns filterConditions.length', () => {
    uiState.filterConditions = [];
    expect(countActiveFilters()).toBe(0);
    uiState.filterConditions = [{ type: 'scope', values: [] }, { type: 'isCustom' }];
    expect(countActiveFilters()).toBe(2);
  });
});

describe('clearAllFilters', () => {
  it('empties filterConditions and clears selectedScopes', () => {
    uiState.filterConditions = [{ type: 'scope', values: ['global'] }];
    uiState.selectedScopes = new Set(['global']);
    clearAllFilters();
    expect(uiState.filterConditions).toHaveLength(0);
    expect(uiState.selectedScopes.size).toBe(0);
  });
});

describe('syncSelectedScopes', () => {
  it('sets selectedScopes from scope condition values', () => {
    uiState.filterConditions = [{ type: 'scope', values: ['global', 'sn_hr_core'] }];
    syncSelectedScopes();
    expect(uiState.selectedScopes).toEqual(new Set(['global', 'sn_hr_core']));
  });

  it('clears selectedScopes when no scope condition present', () => {
    uiState.filterConditions = [{ type: 'isCustom' }];
    uiState.selectedScopes = new Set(['global']);
    syncSelectedScopes();
    expect(uiState.selectedScopes.size).toBe(0);
  });
});

// ── access (Table Access) condition (#41) ────────────────────────────────────

describe('access condition', () => {
  const PP_NODE = {
    id: 'pp_table',
    label: 'PP',
    scope: 'sn_app',
    access: 'package_private',
    fields: [],
  };
  const PUB_NODE = { id: 'pub_table', label: 'Pub', scope: 'global', access: 'public', fields: [] };
  const NULL_NODE = { id: 'plain', label: 'Plain', scope: 'global', access: null, fields: [] };

  it('package_private matches only package_private tables', () => {
    uiState.filterConditions = [{ type: 'access', value: 'package_private' }];
    expect(filterOk(PP_NODE)).toBe(true);
    expect(filterOk(PUB_NODE)).toBe(false);
    expect(filterOk(NULL_NODE)).toBe(false);
  });

  it('public matches everything that is not package_private (incl. null access)', () => {
    uiState.filterConditions = [{ type: 'access', value: 'public' }];
    expect(filterOk(PP_NODE)).toBe(false);
    expect(filterOk(PUB_NODE)).toBe(true);
    expect(filterOk(NULL_NODE)).toBe(true);
  });

  it('passes all nodes when no value is selected', () => {
    uiState.filterConditions = [{ type: 'access', value: '' }];
    expect(filterOk(PP_NODE)).toBe(true);
    expect(filterOk(NULL_NODE)).toBe(true);
  });
});

// ── Memoisation (Phase 3, M4) ───────────────────────────────────────────────
//
// filterOk caches per-node verdicts keyed by a signature of the conditions and
// the graph reference. These tests verify the cache invalidates correctly so it
// never returns a stale result.

describe('filterOk memoisation', () => {
  it('returns the same verdict on repeated calls (cache hit)', () => {
    uiState.filterConditions = [{ type: 'scope', values: ['global'] }];
    expect(filterOk(GLOBAL_NODE)).toBe(true);
    expect(filterOk(GLOBAL_NODE)).toBe(true);
    expect(filterOk(SCOPED_NODE)).toBe(false);
    expect(filterOk(SCOPED_NODE)).toBe(false);
  });

  it('re-evaluates when conditions change (same graph)', () => {
    uiState.filterConditions = [{ type: 'scope', values: ['global'] }];
    expect(filterOk(SCOPED_NODE)).toBe(false); // primes the cache

    // Widen the filter — the previously-cached "false" must not stick.
    uiState.filterConditions = [{ type: 'scope', values: ['global', 'sn_hr_core'] }];
    expect(filterOk(SCOPED_NODE)).toBe(true);
  });

  it('re-evaluates when the graph reference changes (same conditions, same id)', () => {
    uiState.filterConditions = [{ type: 'scope', values: ['global'] }];
    const original = { id: 'task', scope: 'global', _isView: false, fields: [] };
    graphState.graphData = { nodes: [original] };
    expect(filterOk(original)).toBe(true); // primes the cache for id 'task'

    // New graph load: a different node reuses id 'task' but is out of scope.
    const reused = { id: 'task', scope: 'sn_other', _isView: false, fields: [] };
    graphState.graphData = { nodes: [reused] };
    expect(filterOk(reused)).toBe(false);
  });

  it('falls back to true (and skips the cache) when conditions are cleared', () => {
    uiState.filterConditions = [{ type: 'scope', values: ['global'] }];
    expect(filterOk(SCOPED_NODE)).toBe(false);
    uiState.filterConditions = [];
    expect(filterOk(SCOPED_NODE)).toBe(true);
  });
});
