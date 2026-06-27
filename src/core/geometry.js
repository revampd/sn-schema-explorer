export const Geometry = (() => {
  function makeEdgeGeom(halfW, halfH, minDist) {
    function clip(cx, cy, tx, ty, hh) {
      const hw = halfW,
        hv = hh ?? halfH;
      const dx = tx - cx,
        dy = ty - cy;
      if (!dx && !dy) return { x: cx, y: cy };
      const tX = dx ? (dx > 0 ? hw : -hw) / dx : Infinity;
      const tY = dy ? (dy > 0 ? hv : -hv) / dy : Infinity;
      const t = Math.min(Math.abs(tX), Math.abs(tY));
      const ct = Math.min(t, 1);
      return { x: cx + dx * ct, y: cy + dy * ct };
    }

    function buildPath(sx, sy, tx, ty, shh, thh, offset) {
      const cdx = tx - sx,
        cdy = ty - sy;
      const centreDist = Math.sqrt(cdx * cdx + cdy * cdy);
      const overlapDist = halfW + Math.max(shh ?? halfH, thh ?? halfH);
      if (centreDist < overlapDist) {
        return {
          sp: { x: sx, y: sy },
          tp: { x: tx, y: ty },
          cx: null,
          cy: null,
          straight: true,
          degenerate: true,
        };
      }
      const sp2 = clip(sx, sy, tx, ty, shh),
        tp2 = clip(tx, ty, sx, sy, thh);
      const epDx = tp2.x - sp2.x,
        epDy = tp2.y - sp2.y;
      const sameDir = epDx * cdx + epDy * cdy > 0;
      const epLen = Math.sqrt(epDx * epDx + epDy * epDy);
      if (!sameDir || epLen < 8) {
        return { sp: sp2, tp: tp2, cx: null, cy: null, straight: true, degenerate: true };
      }
      if (centreDist < minDist) {
        return { sp: sp2, tp: tp2, cx: null, cy: null, straight: true };
      }
      const sp = sp2,
        tp = tp2;
      const len = epLen;
      const mx = (sp.x + tp.x) / 2,
        my = (sp.y + tp.y) / 2;
      const px = -epDy / len,
        py = epDx / len;
      const arc = offset === 0 ? (minDist < 100 ? 10 : 12) : offset;
      const maxOff = Math.min(len * 0.35, 40);
      const safeOff = Math.max(-maxOff, Math.min(maxOff, arc));
      const cx = mx + px * safeOff;
      const cy = my + py * safeOff;
      return { sp, tp, cx, cy, straight: false };
    }

    function edgePath(sx, sy, tx, ty, shh, thh, offset) {
      const g = buildPath(sx, sy, tx, ty, shh, thh, offset);
      if (g.degenerate) return null;
      if (g.straight) return `M${g.sp.x},${g.sp.y} L${g.tp.x},${g.tp.y}`;
      return `M${g.sp.x},${g.sp.y} Q${g.cx},${g.cy} ${g.tp.x},${g.tp.y}`;
    }

    function bezierMid(sx, sy, tx, ty, shh, thh, offset) {
      const g = buildPath(sx, sy, tx, ty, shh, thh, offset);
      if (g.degenerate || g.straight) return { x: (g.sp.x + g.tp.x) / 2, y: (g.sp.y + g.tp.y) / 2 };
      return {
        x: 0.25 * g.sp.x + 0.5 * g.cx + 0.25 * g.tp.x,
        y: 0.25 * g.sp.y + 0.5 * g.cy + 0.25 * g.tp.y,
      };
    }

    return { clip, edgePath, bezierMid };
  }
  return { makeEdgeGeom };
})();

export const makeEdgeGeom = Geometry.makeEdgeGeom;
