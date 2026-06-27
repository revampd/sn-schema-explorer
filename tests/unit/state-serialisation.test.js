/**
 * Unit tests for serializeState / restoreState in src/core/state.js (#47.2).
 *
 * state.js only touches uiState (and a restore callback) — no DOM — so we can
 * import the real singletons and exercise the round-trip directly.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { serializeState, restoreState } from '../../src/core/state.js';
import { uiState } from '../../src/core/state.js';

beforeEach(() => {
  // Reset the fields the serialiser touches to known defaults.
  uiState.selectedNode = null;
  uiState.viewMode = 'force';
  uiState.maxNodes = 10;
  uiState.hopDepth = 1;
  uiState.sortMode = 'name-asc';
  uiState.showRefTo = true;
  uiState.showRefFrom = false;
  uiState.showExt = false;
  uiState.showM2M = false;
  uiState.showRel = false;
  uiState.showView = false;
  uiState.showCmdbRel = false;
  uiState.showLabels = false;
  uiState.showFields = false;
  uiState.filterConditions = [];
  uiState.hiddenNodes = new Set();
  uiState.selectedScopes = new Set();
});

describe('serializeState / restoreState round-trip', () => {
  it('restores scalar + boolean fields', () => {
    uiState.selectedNode = 'incident';
    uiState.viewMode = 'diff';
    uiState.maxNodes = 42;
    uiState.hopDepth = 3;
    uiState.sortMode = 'fields-desc';
    uiState.showExt = true;
    uiState.showM2M = true;
    uiState.showLabels = true;

    const json = serializeState();

    // Mutate to defaults, then restore.
    uiState.maxNodes = 10;
    uiState.hopDepth = 1;
    uiState.viewMode = 'force';
    uiState.showExt = false;
    uiState.showM2M = false;
    uiState.showLabels = false;

    restoreState(json);

    expect(uiState.maxNodes).toBe(42);
    expect(uiState.hopDepth).toBe(3);
    expect(uiState.viewMode).toBe('diff');
    expect(uiState.sortMode).toBe('fields-desc');
    expect(uiState.showExt).toBe(true);
    expect(uiState.showM2M).toBe(true);
    expect(uiState.showLabels).toBe(true);
  });

  it('round-trips filterConditions (with a cloned scope values array)', () => {
    uiState.filterConditions = [
      { id: 'fc1', type: 'scope', connector: 'AND', values: ['global', 'sn_hr_core'] },
      { id: 'fc2', type: 'name', connector: 'AND', operator: 'contains', value: 'inc' },
    ];
    const json = serializeState();
    uiState.filterConditions = [];

    restoreState(json);

    expect(uiState.filterConditions).toHaveLength(2);
    expect(uiState.filterConditions[0]).toMatchObject({
      type: 'scope',
      values: ['global', 'sn_hr_core'],
    });
    expect(uiState.filterConditions[1]).toMatchObject({
      type: 'name',
      operator: 'contains',
      value: 'inc',
    });
  });

  it('syncs selectedScopes (a Set) from the restored scope condition', () => {
    uiState.filterConditions = [{ id: 'fc1', type: 'scope', values: ['global'] }];
    const json = serializeState();
    uiState.filterConditions = [];
    uiState.selectedScopes = new Set();

    restoreState(json);

    expect(uiState.selectedScopes).toBeInstanceOf(Set);
    expect([...uiState.selectedScopes]).toEqual(['global']);
  });

  it('round-trips hiddenNodes as a Set', () => {
    uiState.hiddenNodes = new Set(['a', 'b', 'c']);
    const json = serializeState();
    uiState.hiddenNodes = new Set();

    restoreState(json);

    expect(uiState.hiddenNodes).toBeInstanceOf(Set);
    expect([...uiState.hiddenNodes].sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('restoreState backward compatibility', () => {
  it('converts legacy selectedScopes array into a scope filterCondition', () => {
    // Old saved views (pre filter-builder) stored selectedScopes, no filterConditions.
    restoreState(JSON.stringify({ selectedScopes: ['Global', 'sn_itsm'] }));

    expect(uiState.filterConditions).toHaveLength(1);
    expect(uiState.filterConditions[0]).toMatchObject({
      type: 'scope',
      values: ['Global', 'sn_itsm'],
    });
    expect([...uiState.selectedScopes]).toEqual(['Global', 'sn_itsm']);
  });

  it('clears filterConditions when neither new nor legacy scope data is present', () => {
    uiState.filterConditions = [{ id: 'x', type: 'scope', values: ['old'] }];
    restoreState(JSON.stringify({ maxNodes: 20 }));
    expect(uiState.filterConditions).toEqual([]);
  });
});

describe('restoreState error handling', () => {
  it('does not throw on malformed JSON', () => {
    uiState.maxNodes = 7;
    expect(() => restoreState('{ not valid json')).not.toThrow();
    // State left intact (the parse failed before any mutation).
    expect(uiState.maxNodes).toBe(7);
  });
});
