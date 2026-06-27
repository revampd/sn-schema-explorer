/**
 * Unit tests for src/core/diff-state.js — the comparison-layer predicate (#150).
 *
 * The canvas comparison overlay is ONE "Differences" layer toggled by
 * `_diffLayerOn`. There is no structure/config split — config drift lives in the
 * inspector, not on the canvas. `isStructureLayerOn` gates the overlay and
 * requires a comparison to be active.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { diffState, isComparing, isStructureLayerOn } from '../../../src/core/diff-state.js';

beforeEach(() => {
  diffState._diffData = null;
  diffState._diffLayerOn = true;
});

describe('isComparing', () => {
  it('is true only when diff data is loaded', () => {
    expect(isComparing()).toBe(false);
    diffState._diffData = { added: new Set() };
    expect(isComparing()).toBe(true);
  });
});

describe('isStructureLayerOn', () => {
  it('requires a comparison AND the Differences layer toggle on', () => {
    expect(isStructureLayerOn()).toBe(false); // not comparing
    diffState._diffData = {};
    expect(isStructureLayerOn()).toBe(true);
    diffState._diffLayerOn = false; // layer toggled off
    expect(isStructureLayerOn()).toBe(false);
  });
});
