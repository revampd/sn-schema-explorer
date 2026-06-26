/**
 * Unit tests for src/viewer/engine/type-badge.js — the field type → badge
 * colour / label helpers extracted from render.js (#73). Pure aside from
 * reading graphState.graphData._typeCatalog.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { typeBadgeColor, typeLabel } from '../../src/viewer/engine/type-badge.js';
import { graphState } from '../../src/viewer/core/state.js';

beforeEach(() => {
  graphState.graphData = null;
});

describe('typeBadgeColor', () => {
  it('maps a known type to its swatch colour', () => {
    expect(typeBadgeColor('string')).toBe('#cdd9e5');
    expect(typeBadgeColor('integer')).toBe('#ffd166');
    expect(typeBadgeColor('reference')).toBe('#a090ff');
  });

  it('normalises case and separators before lookup', () => {
    expect(typeBadgeColor('Glide Date Time')).toBe('#ff9f5a');
    expect(typeBadgeColor('TRUE_FALSE')).toBe('#06d6a0');
  });

  it('falls back to a deterministic hashed oklch colour for unknown types', () => {
    const c = typeBadgeColor('totally_made_up_type');
    expect(c).toMatch(/^oklch\(72% 0\.13 \d+\)$/);
    expect(typeBadgeColor('totally_made_up_type')).toBe(c); // deterministic
  });

  it('uses the type catalog scalarType as a fallback when present', () => {
    graphState.graphData = {
      _typeCatalog: { my_custom: { scalarType: 'integer' } },
    };
    expect(typeBadgeColor('my_custom')).toBe('#ffd166');
  });
});

describe('typeLabel', () => {
  it('returns the raw type when there is no catalog', () => {
    expect(typeLabel('glide_date_time')).toBe('glide_date_time');
  });

  it('returns the empty string for a falsy type', () => {
    expect(typeLabel('')).toBe('');
    expect(typeLabel(null)).toBe('');
  });

  it('prefers the catalog label when present', () => {
    graphState.graphData = {
      _typeCatalog: { glide_date_time: { label: 'Date/Time' } },
    };
    expect(typeLabel('glide_date_time')).toBe('Date/Time');
  });
});
