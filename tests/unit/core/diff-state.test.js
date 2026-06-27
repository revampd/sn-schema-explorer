/**
 * Unit tests for src/core/diff-state.js — the comparison-layer predicates (#150).
 *
 * The canvas comparison overlay is one "Differences" layer with a master switch
 * (`_diffLayerOn`) and two channels (`_structureLayer`, `_configLayer`). The
 * predicates gate the structure colouring and the config badges respectively, and
 * all require a comparison to be active.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  diffState,
  isComparing,
  isStructureLayerOn,
  isConfigLayerOn,
} from '../../../src/core/diff-state.js';

beforeEach(() => {
  diffState._diffData = null;
  diffState._diffLayerOn = true;
  diffState._structureLayer = true;
  diffState._configLayer = true;
});

describe('isComparing', () => {
  it('is true only when diff data is loaded', () => {
    expect(isComparing()).toBe(false);
    diffState._diffData = { added: new Set() };
    expect(isComparing()).toBe(true);
  });
});

describe('isStructureLayerOn', () => {
  it('requires a comparison, the master, and the structure sub all on', () => {
    expect(isStructureLayerOn()).toBe(false); // not comparing
    diffState._diffData = {};
    expect(isStructureLayerOn()).toBe(true);
    diffState._structureLayer = false;
    expect(isStructureLayerOn()).toBe(false);
    diffState._structureLayer = true;
    diffState._diffLayerOn = false; // master off mutes the channel
    expect(isStructureLayerOn()).toBe(false);
  });
});

describe('isConfigLayerOn', () => {
  it('requires a comparison, the master, and the config sub all on', () => {
    expect(isConfigLayerOn()).toBe(false); // not comparing
    diffState._diffData = {};
    expect(isConfigLayerOn()).toBe(true);
    diffState._configLayer = false;
    expect(isConfigLayerOn()).toBe(false);
    diffState._configLayer = true;
    diffState._diffLayerOn = false; // master off mutes both channels
    expect(isConfigLayerOn()).toBe(false);
    expect(isStructureLayerOn()).toBe(false);
  });
});
