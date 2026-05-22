/**
 * Unit tests for src/viewer/engine/geometry.js
 *
 * Geometry.makeEdgeGeom(halfW, halfH, minDist) returns a closure { clip, edgePath, bezierMid }.
 * All functions are pure math — no DOM or state dependencies.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { makeEdgeGeom } from '../../src/viewer/engine/geometry.js';

// Use small, round numbers for easy manual verification.
// halfW=10, halfH=10 → square box; minDist=50 → curves start at 50+ centre distance.
let clip, edgePath, bezierMid;

beforeAll(() => {
  ({ clip, edgePath, bezierMid } = makeEdgeGeom(10, 10, 50));
});

// ── clip ──────────────────────────────────────────────────────────────────────
describe('clip', () => {
  it('returns centre when source and target are the same point', () => {
    const p = clip(5, 5, 5, 5);
    expect(p).toEqual({ x: 5, y: 5 });
  });

  it('clips to the horizontal box boundary', () => {
    // From (0,0) toward (100,0) — clips at halfW=10
    const p = clip(0, 0, 100, 0);
    expect(p.x).toBeCloseTo(10);
    expect(p.y).toBeCloseTo(0);
  });

  it('clips to the vertical box boundary', () => {
    // From (0,0) toward (0,100) — clips at halfH=10
    const p = clip(0, 0, 0, 100);
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(10);
  });

  it('clips to the nearer boundary on a diagonal', () => {
    // From (0,0) toward (30,60) — halfW=10, halfH=10
    // tX = 10/30 ≈ 0.333, tY = 10/60 ≈ 0.167 → min = 0.167
    // clip point: (30*0.167, 60*0.167) ≈ (5, 10)
    const p = clip(0, 0, 30, 60);
    expect(p.x).toBeCloseTo(5, 1);
    expect(p.y).toBeCloseTo(10, 1);
  });

  it('honours the halfH override parameter', () => {
    // makeEdgeGeom halfH=10, but pass hh=20 override
    const p = clip(0, 0, 0, 100, 20);
    expect(p.y).toBeCloseTo(20);
  });
});

// ── edgePath ──────────────────────────────────────────────────────────────────
describe('edgePath', () => {
  it('returns null for degenerate (overlapping) nodes', () => {
    // Nodes at (0,0) and (5,0): centre distance 5 < overlapDist(20) → degenerate
    expect(edgePath(0, 0, 5, 0)).toBeNull();
  });

  it('returns null when clipped endpoints point in opposite direction', () => {
    // Nodes very close but outside box overlap: the clip points reverse
    expect(edgePath(0, 0, 15, 0)).toBeNull();
  });

  it('returns a straight-line path (M..L..) when nodes are within minDist', () => {
    // Centre distance 45 → overlapDist=20, so not degenerate, but < minDist=50
    // offset=0 → use default arc (required; undefined offset produces NaN)
    const path = edgePath(0, 0, 45, 0, undefined, undefined, 0);
    expect(path).not.toBeNull();
    expect(path).toMatch(/^M[\d.,]+ L[\d.,]+/);
    expect(path).not.toContain('Q');
  });

  it('returns a quadratic bezier path (M..Q..) for nodes beyond minDist', () => {
    // Centre distance 200 → well beyond minDist=50; offset=0 = default single-edge arc
    const path = edgePath(0, 0, 200, 0, undefined, undefined, 0);
    expect(path).not.toBeNull();
    expect(path).toMatch(/^M[\d.,]+ Q[\d.,]+ [\d.,]+/);
  });

  it('bezier path starts at the clipped source edge', () => {
    const path = edgePath(0, 0, 200, 0, undefined, undefined, 0);
    // Source node at (0,0), halfW=10 → path starts at "M10,0"
    expect(path).toMatch(/^M10,0 /);
  });
});

// ── bezierMid ─────────────────────────────────────────────────────────────────
describe('bezierMid', () => {
  it('returns the geometric midpoint for a straight-line path', () => {
    // (0,0)→(45,0): sp=(10,0), tp=(35,0) → mid=(22.5,0)
    const mid = bezierMid(0, 0, 45, 0);
    expect(mid.x).toBeCloseTo(22.5);
    expect(mid.y).toBeCloseTo(0);
  });

  it('returns the quadratic bezier midpoint (t=0.5) for a curved path', () => {
    // (0,0)→(200,0) with offset=0: sp=(10,0), tp=(190,0), control=(100,10)
    // quadratic at t=0.5: 0.25*sp + 0.5*ctrl + 0.25*tp
    // x = 0.25*10 + 0.5*100 + 0.25*190 = 2.5 + 50 + 47.5 = 100
    // y = 0.25*0  + 0.5*10  + 0.25*0   = 0 + 5 + 0 = 5
    const mid = bezierMid(0, 0, 200, 0, undefined, undefined, 0);
    expect(mid.x).toBeCloseTo(100);
    expect(mid.y).toBeCloseTo(5);
  });

  it('returns a point for degenerate nodes without throwing', () => {
    // Should not throw — returns some midpoint
    expect(() => bezierMid(0, 0, 5, 0)).not.toThrow();
  });
});
