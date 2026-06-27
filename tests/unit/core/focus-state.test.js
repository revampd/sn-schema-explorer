/**
 * Unit tests for src/core/focus-state.js — the shared "focus" facade (#131).
 *
 * focus-state is a thin facade over three existing singletons (instancesState,
 * diffState, uiState). It owns no storage; these tests assert that it READS live
 * from them, that the `table` setter writes through + notifies, and that
 * `onFocusChange` fires with a correct snapshot and can be unsubscribed.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  focusState,
  onFocusChange,
  focusSnapshot,
  notifyFocusChange,
} from '../../../src/core/focus-state.js';
import { instancesState } from '../../../src/core/instances-state.js';
import { diffState } from '../../../src/core/diff-state.js';
import { uiState } from '../../../src/core/ui-state.js';

beforeEach(() => {
  instancesState.selectedId = null;
  diffState._compareId = null;
  uiState.selectedNode = null;
});

describe('focusState facade — reads live from the singletons', () => {
  it('resolves instanceId / compareId / table from the underlying state', () => {
    instancesState.selectedId = 'i_dev';
    diffState._compareId = 'i_prod';
    uiState.selectedNode = 'incident';
    expect(focusState.instanceId).toBe('i_dev');
    expect(focusState.compareId).toBe('i_prod');
    expect(focusState.table).toBe('incident');
  });

  it('never drifts — reflects later mutations of the singletons', () => {
    expect(focusState.table).toBeNull();
    uiState.selectedNode = 'task';
    expect(focusState.table).toBe('task');
  });
});

describe('focusState.table setter', () => {
  it('writes through to uiState.selectedNode and notifies on change', () => {
    const spy = vi.fn();
    const off = onFocusChange(spy);
    focusState.table = 'cmdb_ci';
    expect(uiState.selectedNode).toBe('cmdb_ci');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ table: 'cmdb_ci' }));
    off();
  });

  it('is a no-op (no notify) when the value is unchanged', () => {
    uiState.selectedNode = 'task';
    const spy = vi.fn();
    const off = onFocusChange(spy);
    focusState.table = 'task';
    expect(spy).not.toHaveBeenCalled();
    off();
  });
});

describe('focusSnapshot()', () => {
  it('returns a point-in-time copy of all three tiers', () => {
    instancesState.selectedId = 'i_a';
    diffState._compareId = 'i_b';
    uiState.selectedNode = 'task';
    expect(focusSnapshot()).toEqual({ instanceId: 'i_a', compareId: 'i_b', table: 'task' });
  });
});

describe('onFocusChange / notifyFocusChange', () => {
  it('fires every subscriber with the current snapshot', () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = onFocusChange(a);
    const offB = onFocusChange(b);
    instancesState.selectedId = 'i_x';
    notifyFocusChange();
    expect(a).toHaveBeenCalledWith(expect.objectContaining({ instanceId: 'i_x' }));
    expect(b).toHaveBeenCalledWith(expect.objectContaining({ instanceId: 'i_x' }));
    offA();
    offB();
  });

  it('unsubscribe stops further notifications', () => {
    const spy = vi.fn();
    const off = onFocusChange(spy);
    notifyFocusChange();
    expect(spy).toHaveBeenCalledTimes(1);
    off();
    notifyFocusChange();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('a throwing listener does not break the others', () => {
    const bad = vi.fn(() => {
      throw new Error('boom');
    });
    const good = vi.fn();
    const offBad = onFocusChange(bad);
    const offGood = onFocusChange(good);
    expect(() => notifyFocusChange()).not.toThrow();
    expect(good).toHaveBeenCalled();
    offBad();
    offGood();
  });
});
