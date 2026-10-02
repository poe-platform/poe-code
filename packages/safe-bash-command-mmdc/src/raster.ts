import { drainWork } from "./work.js";
import {
  MermaidBudget,
  MermaidError,
  type MermaidScene,
  type PathSegment,
  type Point,
  type SceneLabelPill,
  type SceneMarker,
  type SceneNode,
  type SceneTextLine
} from "./contracts.js";
import { getEmbeddedFont, getGlyphOutline, type GlyphPoint } from "./font.js";
import { parseCssColor, type RgbaColor } from "./theme.js";

export interface RasterOptions {
  readonly scale?: number | undefined;
  readonly budget?: MermaidBudget | undefined;
}

export interface RasterFrame {
  readonly rgba: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly scale: number;
}

const SUB_OFFSETS = [0.125, 0.375, 0.625, 0.875] as const;

function blendPixel(
  rgba: Uint8Array,
  idx: number,
  color: RgbaColor,
  coverage: number
): void {
  const srcA = (color.a / 255) * coverage;
  if (srcA <= 0.001) return;
  const dstA = rgba[idx + 3]! / 255;

  if (srcA >= 0.999 && color.a === 255) {
    rgba[idx] = color.r;
    rgba[idx + 1] = color.g;
    rgba[idx + 2] = color.b;
    rgba[idx + 3] = 255;
    return;
  }

  const outA = srcA + dstA * (1 - srcA);
  if (outA <= 0.0001) {
    rgba[idx] = 0;
    rgba[idx + 1] = 0;
    rgba[idx + 2] = 0;
    rgba[idx + 3] = 0;
    return;
  }

  const dstR = rgba[idx]!;
  const dstG = rgba[idx + 1]!;
  const dstB = rgba[idx + 2]!;

  rgba[idx] = Math.round((color.r * srcA + dstR * dstA * (1 - srcA)) / outA);
  rgba[idx + 1] = Math.round((color.g * srcA + dstG * dstA * (1 - srcA)) / outA);
  rgba[idx + 2] = Math.round((color.b * srcA + dstB * dstA * (1 - srcA)) / outA);
  rgba[idx + 3] = Math.round(outA * 255);
}

function sdfRoundedRect(
  px: number,
  py: number,
  cx: number,
  cy: number,
  halfW: number,
  halfH: number,
  rx: number
): number {
  const r = Math.min(rx, halfW, halfH);
  const qx = Math.abs(px - cx) - (halfW - r);
  const qy = Math.abs(py - cy) - (halfH - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function sdfDiamond(
  px: number,
  py: number,
  cx: number,
  cy: number,
  halfW: number,
  halfH: number,
  cornerR: number
): number {
  const dx = Math.abs(px - cx);
  const dy = Math.abs(py - cy);
  const norm = Math.hypot(halfW, halfH);
  if (norm === 0) return 0;
  // Signed distance to line x/halfW + y/halfH = 1
  const rawDist = ((dx * halfH + dy * halfW - halfW * halfH) / norm) + cornerR * 0.35;
  return rawDist - cornerR * 0.35;
}

function* drawShadowSteps(
  rgba: Uint8Array,
  frameW: number,
  frameH: number,
  x: number,
  y: number,
  w: number,
  h: number,
  rx: number,
  isDiamond: boolean,
  shadowColor: RgbaColor,
  scale: number
): Generator<void, void, void> {
  yield;

  let work = 0;

  if (shadowColor.a <= 0) return;
  const dy = 1.6 * scale;
  const blur = 3.5 * scale;
  const cx = (x + w / 2) * scale;
  const cy = (y + h / 2) * scale + dy;
  const halfW = (w / 2) * scale;
  const halfH = (h / 2) * scale;
  const rScaled = rx * scale;

  const minX = Math.max(0, Math.floor(cx - halfW - blur - 2));
  const maxX = Math.min(frameW - 1, Math.ceil(cx + halfW + blur + 2));
  const minY = Math.max(0, Math.floor(cy - halfH - blur - 2));
  const maxY = Math.min(frameH - 1, Math.ceil(cy + halfH + blur + 2));

  for (let py = minY; py <= maxY; py++) {
    if (++work % 4096 === 0) yield;

    for (let px = minX; px <= maxX; px++) {
      if (++work % 4096 === 0) yield;

      const dist = isDiamond
        ? sdfDiamond(px + 0.5, py + 0.5, cx, cy, halfW, halfH, rScaled)
        : sdfRoundedRect(px + 0.5, py + 0.5, cx, cy, halfW, halfH, rScaled);
      if (dist >= blur) continue;
      // Smooth Gaussian-like falloff
      const t = Math.max(0, Math.min(1, (blur - dist) / (blur * 1.4)));
      const smooth = t * t * (3 - 2 * t);
      blendPixel(rgba, (py * frameW + px) * 4, shadowColor, smooth);
    }
  }
}

function* drawRoundedShapeSteps(
  rgba: Uint8Array,
  frameW: number,
  frameH: number,
  x: number,
  y: number,
  w: number,
  h: number,
  rx: number,
  isDiamond: boolean,
  fill: RgbaColor,
  headerFill: RgbaColor | undefined,
  headerHeight: number | undefined,
  stroke: RgbaColor,
  strokeWidth: number,
  dashed: boolean,
  scale: number
): Generator<void, void, void> {
  yield;

  let work = 0;

  const cx = (x + w / 2) * scale;
  const cy = (y + h / 2) * scale;
  const halfW = (w / 2) * scale;
  const halfH = (h / 2) * scale;
  const rScaled = rx * scale;
  const halfStroke = (strokeWidth * scale) / 2;
  const headerCutY = headerHeight !== undefined ? (y + headerHeight) * scale : -Infinity;

  const minX = Math.max(0, Math.floor(cx - halfW - halfStroke - 2));
  const maxX = Math.min(frameW - 1, Math.ceil(cx + halfW + halfStroke + 2));
  const minY = Math.max(0, Math.floor(cy - halfH - halfStroke - 2));
  const maxY = Math.min(frameH - 1, Math.ceil(cy + halfH + halfStroke + 2));

  for (let py = minY; py <= maxY; py++) {
    if (++work % 4096 === 0) yield;

    for (let px = minX; px <= maxX; px++) {
      if (++work % 4096 === 0) yield;

      const centerDist = isDiamond
        ? sdfDiamond(px + 0.5, py + 0.5, cx, cy, halfW, halfH, rScaled)
        : sdfRoundedRect(px + 0.5, py + 0.5, cx, cy, halfW, halfH, rScaled);

      if (centerDist > halfStroke + 1.2) continue;

      const idx = (py * frameW + px) * 4;

      // Fast interior fill path when well inside border and away from header divider
      if (
        centerDist < -halfStroke - 1.2 &&
        (headerFill === undefined || Math.abs(py + 0.5 - headerCutY) > 1.2)
      ) {
        const activeFill =
          headerFill !== undefined && py + 0.5 <= headerCutY ? headerFill : fill;
        blendPixel(rgba, idx, activeFill, 1);
        continue;
      }

      // Full 4x4 subpixel analytic area coverage
      let fillCount = 0;
      let headerCount = 0;
      let strokeCount = 0;

      for (let sy = 0; sy < 4; sy++) {
        if (++work % 4096 === 0) yield;

        const sampleY = py + SUB_OFFSETS[sy]!;
        const inHeader = headerFill !== undefined && sampleY <= headerCutY;
        for (let sx = 0; sx < 4; sx++) {
          if (++work % 4096 === 0) yield;

          const sampleX = px + SUB_OFFSETS[sx]!;
          const d = isDiamond
            ? sdfDiamond(sampleX, sampleY, cx, cy, halfW, halfH, rScaled)
            : sdfRoundedRect(sampleX, sampleY, cx, cy, halfW, halfH, rScaled);

          if (d <= 0) {
            if (inHeader) headerCount++;
            else fillCount++;
          }
          if (Math.abs(d) <= halfStroke) {
            if (!dashed || ((Math.floor((sampleX + sampleY) / (4 * scale))) % 2 === 0)) {
              strokeCount++;
            }
          }
        }
      }

      if (fillCount > 0) blendPixel(rgba, idx, fill, fillCount / 16);
      if (headerCount > 0 && headerFill) blendPixel(rgba, idx, headerFill, headerCount / 16);
      if (strokeCount > 0) blendPixel(rgba, idx, stroke, strokeCount / 16);
    }
  }
}

function distToSegmentSq(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): { readonly distSq: number; readonly t: number } {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 1e-6) {
    const ddx = px - x1;
    const ddy = py - y1;
    return { distSq: ddx * ddx + ddy * ddy, t: 0 };
  }
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  const ddx = px - projX;
  const ddy = py - projY;
  return { distSq: ddx * ddx + ddy * ddy, t };
}

function flattenSegments(segments: readonly PathSegment[], scale: number): readonly Point[] {
  const pts: Point[] = [];
  let curr: Point = { x: 0, y: 0 };
  for (const seg of segments) {
    if (seg.kind === "M") {
      curr = { x: seg.x * scale, y: seg.y * scale };
      pts.push(curr);
    } else if (seg.kind === "L") {
      curr = { x: seg.x * scale, y: seg.y * scale };
      pts.push(curr);
    } else if (seg.kind === "Q") {
      const p0 = curr;
      const cx = seg.cx * scale;
      const cy = seg.cy * scale;
      const p1 = { x: seg.x * scale, y: seg.y * scale };
      const steps = 12;
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const inv = 1 - t;
        pts.push({
          x: inv * inv * p0.x + 2 * inv * t * cx + t * t * p1.x,
          y: inv * inv * p0.y + 2 * inv * t * cy + t * t * p1.y
        });
      }
      curr = p1;
    }
  }
  return pts;
}

function* drawPolyline4x4Steps(
  rgba: Uint8Array,
  frameW: number,
  frameH: number,
  pts: readonly Point[],
  color: RgbaColor,
  strokeWidthPx: number,
  dashed: boolean,
  scale: number
): Generator<void, void, void> {
  yield;

  let work = 0;

  if (pts.length < 2) return;
  const radius = strokeWidthPx / 2;
  const radiusSq = radius * radius;
  const dashPeriod = 9 * scale;
  const dashOn = 5 * scale;

  // Compute cumulative arc length at each vertex
  const cumLen: number[] = [0];
  let minX = pts[0]!.x;
  let maxX = pts[0]!.x;
  let minY = pts[0]!.y;
  let maxY = pts[0]!.y;

  for (let i = 1; i < pts.length; i++) {
    if (++work % 4096 === 0) yield;

    const p0 = pts[i - 1]!;
    const p1 = pts[i]!;
    cumLen.push(cumLen[i - 1]! + Math.hypot(p1.x - p0.x, p1.y - p0.y));
    if (p1.x < minX) minX = p1.x;
    if (p1.x > maxX) maxX = p1.x;
    if (p1.y < minY) minY = p1.y;
    if (p1.y > maxY) maxY = p1.y;
  }

  const x0 = Math.max(0, Math.floor(minX - radius - 2));
  const x1 = Math.min(frameW - 1, Math.ceil(maxX + radius + 2));
  const y0 = Math.max(0, Math.floor(minY - radius - 2));
  const y1 = Math.min(frameH - 1, Math.ceil(maxY + radius + 2));

  // For each segment, rasterize its local bounding box using a coverage mask buffer
  const boxW = x1 - x0 + 1;
  const boxH = y1 - y0 + 1;
  if (boxW <= 0 || boxH <= 0) return;

  for (let py = y0; py <= y1; py++) {
    if (++work % 4096 === 0) yield;

    for (let px = x0; px <= x1; px++) {
      if (++work % 4096 === 0) yield;

      // Quick coarse reject against all segments
      let minCenterDistSq = Infinity;
      for (let i = 0; i < pts.length - 1; i++) {
        if (++work % 4096 === 0) yield;

        const a = pts[i]!;
        const b = pts[i + 1]!;
        const d = distToSegmentSq(px + 0.5, py + 0.5, a.x, a.y, b.x, b.y);
        if (d.distSq < minCenterDistSq) minCenterDistSq = d.distSq;
      }
      if (minCenterDistSq > (radius + 1.1) * (radius + 1.1)) continue;

      let hits = 0;
      for (let sy = 0; sy < 4; sy++) {
        if (++work % 4096 === 0) yield;

        const sampleY = py + SUB_OFFSETS[sy]!;
        for (let sx = 0; sx < 4; sx++) {
          if (++work % 4096 === 0) yield;

          const sampleX = px + SUB_OFFSETS[sx]!;
          let inside = false;
          for (let i = 0; i < pts.length - 1; i++) {
            if (++work % 4096 === 0) yield;

            const a = pts[i]!;
            const b = pts[i + 1]!;
            const res = distToSegmentSq(sampleX, sampleY, a.x, a.y, b.x, b.y);
            if (res.distSq <= radiusSq) {
              if (!dashed) {
                inside = true;
                break;
              }
              const segLen = cumLen[i + 1]! - cumLen[i]!;
              const arc = cumLen[i]! + res.t * segLen;
              if (arc % dashPeriod <= dashOn) {
                inside = true;
                break;
              }
            }
          }
          if (inside) hits++;
        }
      }
      if (hits > 0) {
        blendPixel(rgba, (py * frameW + px) * 4, color, hits / 16);
      }
    }
  }
}

function pointInPolygon(px: number, py: number, poly: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i]!.x;
    const yi = poly[i]!.y;
    const xj = poly[j]!.x;
    const yj = poly[j]!.y;
    const intersect =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function* drawPolygon4x4Steps(
  rgba: Uint8Array,
  frameW: number,
  frameH: number,
  poly: readonly Point[],
  fill: RgbaColor | undefined,
  stroke: RgbaColor | undefined,
  strokeWidthPx: number
): Generator<void, void, void> {
  yield;

  let work = 0;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    if (++work % 4096 === 0) yield;

    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const halfStroke = strokeWidthPx / 2;
  const x0 = Math.max(0, Math.floor(minX - halfStroke - 2));
  const x1 = Math.min(frameW - 1, Math.ceil(maxX + halfStroke + 2));
  const y0 = Math.max(0, Math.floor(minY - halfStroke - 2));
  const y1 = Math.min(frameH - 1, Math.ceil(maxY + halfStroke + 2));

  for (let py = y0; py <= y1; py++) {
    if (++work % 4096 === 0) yield;

    for (let px = x0; px <= x1; px++) {
      if (++work % 4096 === 0) yield;

      let fillHits = 0;
      let strokeHits = 0;
      for (let sy = 0; sy < 4; sy++) {
        if (++work % 4096 === 0) yield;

        const sampleY = py + SUB_OFFSETS[sy]!;
        for (let sx = 0; sx < 4; sx++) {
          if (++work % 4096 === 0) yield;

          const sampleX = px + SUB_OFFSETS[sx]!;
          if (fill && pointInPolygon(sampleX, sampleY, poly)) {
            fillHits++;
          }
          if (stroke && halfStroke > 0) {
            for (let i = 0; i < poly.length; i++) {
              if (++work % 4096 === 0) yield;

              const a = poly[i]!;
              const b = poly[(i + 1) % poly.length]!;
              if (
                distToSegmentSq(sampleX, sampleY, a.x, a.y, b.x, b.y).distSq <=
                halfStroke * halfStroke
              ) {
                strokeHits++;
                break;
              }
            }
          }
        }
      }
      const idx = (py * frameW + px) * 4;
      if (fill && fillHits > 0) blendPixel(rgba, idx, fill, fillHits / 16);
      if (stroke && strokeHits > 0) blendPixel(rgba, idx, stroke, strokeHits / 16);
    }
  }
}

function* drawMarker4x4Steps(
  rgba: Uint8Array,
  frameW: number,
  frameH: number,
  marker: SceneMarker | undefined,
  scale: number
): Generator<void, void, void> {
  yield;



  if (!marker || marker.kind === "none") return;
  const cos = Math.cos(marker.angleRadians);
  const sin = Math.sin(marker.angleRadians);
  const tx = marker.tip.x * scale;
  const ty = marker.tip.y * scale;

  const xform = (lx: number, ly: number): Point => ({
    x: tx + (lx * cos - ly * sin) * scale,
    y: ty + (lx * sin + ly * cos) * scale
  });

  const strokeColor = parseCssColor(marker.stroke);
  const fillColor = parseCssColor(marker.fill);

  if (marker.kind === "arrow") {
    // Sleek swept-back concave dart: tip at (0,0), wings at (-9, -3.5) and (-9, 3.5), inner notch at (-6.8, 0)
    const dart = [xform(-9, -3.5), xform(0, 0), xform(-9, 3.5), xform(-6.8, 0)];
    (yield* drawPolygon4x4Steps(rgba, frameW, frameH, dart, fillColor, strokeColor, 0.9 * scale));
  } else if (marker.kind === "umlHollowTriangle") {
    const tri = [xform(-10, -4), xform(0, 0), xform(-10, 4)];
    (yield* drawPolygon4x4Steps(rgba, frameW, frameH, tri, fillColor, strokeColor, 1.5 * scale));
  } else if (marker.kind === "umlComposition" || marker.kind === "umlAggregation") {
    const dia = [xform(-12, 0), xform(-6, -3.5), xform(0, 0), xform(-6, 3.5)];
    const fill = marker.kind === "umlComposition" ? strokeColor : fillColor;
    (yield* drawPolygon4x4Steps(rgba, frameW, frameH, dia, fill, strokeColor, 1.4 * scale));
  } else if (marker.kind === "openArrow") {
    (yield* drawPolyline4x4Steps(
      rgba,
      frameW,
      frameH,
      [xform(-8, -3.5), xform(0, 0), xform(-8, 3.5)],
      strokeColor,
      1.5 * scale,
      false,
      scale
    ));
  } else if (marker.kind === "cross") {
    (yield* drawPolyline4x4Steps(
      rgba,
      frameW,
      frameH,
      [xform(-9, -4), xform(-1, 4)],
      strokeColor,
      1.75 * scale,
      false,
      scale
    ));
    (yield* drawPolyline4x4Steps(
      rgba,
      frameW,
      frameH,
      [xform(-9, 4), xform(-1, -4)],
      strokeColor,
      1.75 * scale,
      false,
      scale
    ));
  } else if (marker.kind === "erExactlyOne") {
    (yield* drawPolyline4x4Steps(
      rgba,
      frameW,
      frameH,
      [xform(-5, -4.5), xform(-5, 4.5)],
      strokeColor,
      1.5 * scale,
      false,
      scale
    ));
    (yield* drawPolyline4x4Steps(
      rgba,
      frameW,
      frameH,
      [xform(-9, -4.5), xform(-9, 4.5)],
      strokeColor,
      1.5 * scale,
      false,
      scale
    ));
  } else if (marker.kind === "erZeroOrOne") {
    (yield* drawPolyline4x4Steps(
      rgba,
      frameW,
      frameH,
      [xform(-4, -4.5), xform(-4, 4.5)],
      strokeColor,
      1.5 * scale,
      false,
      scale
    ));
    const c = xform(-10, 0);
    (yield* drawRoundedShapeSteps(
      rgba,
      frameW,
      frameH,
      c.x / scale - 3.2,
      c.y / scale - 3.2,
      6.4,
      6.4,
      3.2,
      false,
      fillColor,
      undefined,
      undefined,
      strokeColor,
      1.5,
      false,
      scale
    ));
  } else if (marker.kind === "erOneOrMore") {
    (yield* drawPolyline4x4Steps(
      rgba,
      frameW,
      frameH,
      [xform(-9, -4.5), xform(-9, 4.5)],
      strokeColor,
      1.5 * scale,
      false,
      scale
    ));
    (yield* drawPolyline4x4Steps(
      rgba,
      frameW,
      frameH,
      [xform(0, -4.5), xform(-9, 0), xform(0, 4.5)],
      strokeColor,
      1.5 * scale,
      false,
      scale
    ));
  } else if (marker.kind === "erZeroOrMore") {
    (yield* drawPolyline4x4Steps(
      rgba,
      frameW,
      frameH,
      [xform(0, -4.5), xform(-8, 0), xform(0, 4.5)],
      strokeColor,
      1.5 * scale,
      false,
      scale
    ));
    const c = xform(-12, 0);
    (yield* drawRoundedShapeSteps(
      rgba,
      frameW,
      frameH,
      c.x / scale - 3.2,
      c.y / scale - 3.2,
      6.4,
      6.4,
      3.2,
      false,
      fillColor,
      undefined,
      undefined,
      strokeColor,
      1.5,
      false,
      scale
    ));
  }
}

// Flatten TrueType contour (with on-curve and off-curve quadratic Bézier control points) into closed polygon edges
function flattenGlyphContour(
  contour: readonly GlyphPoint[],
  originX: number,
  baselineY: number,
  pxPerUnit: number
): readonly Point[] {
  const n = contour.length;
  if (n < 2) return [];

  const toScreen = (pt: { x: number; y: number }): Point => ({
    x: originX + pt.x * pxPerUnit,
    y: baselineY - pt.y * pxPerUnit
  });

  // Expand implied on-curve midpoints between consecutive off-curve points
  const expanded: GlyphPoint[] = [];
  for (let i = 0; i < n; i++) {
    const curr = contour[i]!;
    const next = contour[(i + 1) % n]!;
    expanded.push(curr);
    if (!curr.onCurve && !next.onCurve) {
      expanded.push({
        x: (curr.x + next.x) / 2,
        y: (curr.y + next.y) / 2,
        onCurve: true
      });
    }
  }

  // Ensure first point is onCurve
  let startOffset = expanded.findIndex((p) => p.onCurve);
  if (startOffset < 0) startOffset = 0;
  const ordered = [
    ...expanded.slice(startOffset),
    ...expanded.slice(0, startOffset)
  ];

  const out: Point[] = [];
  let i = 0;
  const len = ordered.length;
  while (i < len) {
    const p0 = toScreen(ordered[i]!);
    const next = ordered[(i + 1) % len]!;
    if (next.onCurve) {
      out.push(p0);
      i++;
    } else {
      const ctrl = toScreen(next);
      const p1 = toScreen(ordered[(i + 2) % len]!);
      out.push(p0);
      const steps = 12;
      for (let s = 1; s < steps; s++) {
        const t = s / steps;
        const inv = 1 - t;
        out.push({
          x: inv * inv * p0.x + 2 * inv * t * ctrl.x + t * t * p1.x,
          y: inv * inv * p0.y + 2 * inv * t * ctrl.y + t * t * p1.y
        });
      }
      i += 2;
    }
  }
  return out;
}

const TEXT_SUB_OFFSETS = [0.0625, 0.1875, 0.3125, 0.4375, 0.5625, 0.6875, 0.8125, 0.9375] as const;

function* drawTextLine4x4Steps(
  rgba: Uint8Array,
  frameW: number,
  frameH: number,
  line: SceneTextLine,
  scale: number
): Generator<void, void, void> {
  yield;

  let work = 0;

  if (!line.text) return;
  const color = parseCssColor(line.color);
  const unitsPerEm = getEmbeddedFont().unitsPerEm;
  const pxPerUnit = (line.fontSize * scale) / unitsPerEm;

  let startX = line.x * scale;
  if (line.align === "center") {
    startX = (line.x - line.width / 2) * scale;
  } else if (line.align === "right") {
    startX = (line.x - line.width) * scale;
  }
  const baselineY = line.y * scale;
  const stemBoost = line.fontWeight === 500 && line.fontFamily === "ui" ? 0.08 * scale : 0;

  let cursorX = startX;
  for (const symbol of line.text) {
    if (++work % 4096 === 0) yield;

    const cp = symbol.codePointAt(0)!;
    const glyph = getGlyphOutline(cp, line.fontFamily, line.fontWeight);
    if (glyph.contours.length > 0) {
      const polygons = glyph.contours
        .map((c) => flattenGlyphContour(c, cursorX, baselineY, pxPerUnit))
        .filter((p) => p.length >= 3);

      const minX = Math.max(
        0,
        Math.floor(cursorX + glyph.xMin * pxPerUnit - stemBoost - 1)
      );
      const maxX = Math.min(
        frameW - 1,
        Math.ceil(cursorX + glyph.xMax * pxPerUnit + stemBoost + 1)
      );
      const minY = Math.max(
        0,
        Math.floor(baselineY - glyph.yMax * pxPerUnit - 1)
      );
      const maxY = Math.min(
        frameH - 1,
        Math.ceil(baselineY - glyph.yMin * pxPerUnit + 1)
      );

      // 8x8 non-zero winding subpixel scanline rasterizer per pixel row
      for (let py = minY; py <= maxY; py++) {
        if (++work % 4096 === 0) yield;

        const rowHits = new Uint8Array(maxX - minX + 1);
        for (let sy = 0; sy < 8; sy++) {
          if (++work % 4096 === 0) yield;

          const sampleY = py + TEXT_SUB_OFFSETS[sy]!;
          const crossings: { x: number; dir: number }[] = [];
          for (const poly of polygons) {
            if (++work % 4096 === 0) yield;

            for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
              if (++work % 4096 === 0) yield;

              const p1 = poly[j]!;
              const p2 = poly[i]!;
              if ((p1.y <= sampleY && p2.y > sampleY) || (p2.y <= sampleY && p1.y > sampleY)) {
                const xInt = p1.x + ((sampleY - p1.y) / (p2.y - p1.y)) * (p2.x - p1.x);
                const dir = p1.y < p2.y ? 1 : -1;
                crossings.push({ x: xInt, dir });
              }
            }
          }
          if (crossings.length < 2) continue;
          crossings.sort((a, b) => a.x - b.x);

          let winding = 0;
          let spanStart = 0;
          for (const c of crossings) {
            if (++work % 4096 === 0) yield;

            const prevWinding = winding;
            winding += c.dir;
            if (prevWinding === 0 && winding !== 0) {
              spanStart = c.x;
            } else if (prevWinding !== 0 && winding === 0) {
              const segLeft = spanStart - stemBoost;
              const segRight = c.x + stemBoost;
              const pxStart = Math.max(minX, Math.floor(segLeft));
              const pxEnd = Math.min(maxX, Math.ceil(segRight));
              for (let px = pxStart; px <= pxEnd; px++) {
                if (++work % 4096 === 0) yield;

                for (let sx = 0; sx < 8; sx++) {
                  if (++work % 4096 === 0) yield;

                  const sampleX = px + TEXT_SUB_OFFSETS[sx]!;
                  if (sampleX >= segLeft && sampleX <= segRight) {
                    rowHits[px - minX]!++;
                  }
                }
              }
            }
          }
        }

        for (let px = minX; px <= maxX; px++) {
          if (++work % 4096 === 0) yield;

          const hits = rowHits[px - minX]!;
          if (hits > 0) {
            const coverage = Math.pow(Math.min(1, hits / 64), 0.72);
            blendPixel(
              rgba,
              (py * frameW + px) * 4,
              color,
              coverage
            );
          }
        }
      }
    }
    cursorX += glyph.advanceWidth * pxPerUnit;
  }
}

function* drawPill4x4Steps(
  rgba: Uint8Array,
  frameW: number,
  frameH: number,
  pill: SceneLabelPill,
  scale: number
): Generator<void, void, void> {
  yield;

  let work = 0;

  (yield* drawRoundedShapeSteps(
    rgba,
    frameW,
    frameH,
    pill.x,
    pill.y,
    pill.width,
    pill.height,
    pill.rx,
    false,
    parseCssColor(pill.fill),
    undefined,
    undefined,
    parseCssColor(pill.stroke),
    1,
    false,
    scale
  ));
  for (const line of pill.lines) {
    if (++work % 4096 === 0) yield;

    (yield* drawTextLine4x4Steps(rgba, frameW, frameH, line, scale));
  }
}

function* drawNode4x4Steps(
  rgba: Uint8Array,
  frameW: number,
  frameH: number,
  node: SceneNode,
  shadowColor: RgbaColor,
  scale: number
): Generator<void, void, void> {
  yield;

  let work = 0;

  const fill = parseCssColor(node.fill);
  const stroke = parseCssColor(node.stroke);

  if (node.shape === "stateStart") {
    (yield* drawRoundedShapeSteps(
      rgba,
      frameW,
      frameH,
      node.x + 2,
      node.y + 2,
      node.width - 4,
      node.height - 4,
      (node.width - 4) / 2,
      false,
      fill,
      undefined,
      undefined,
      stroke,
      1.5,
      false,
      scale
    ));
    return;
  }

  if (node.shape === "stateEnd") {
    (yield* drawRoundedShapeSteps(
      rgba,
      frameW,
      frameH,
      node.x + 1,
      node.y + 1,
      node.width - 2,
      node.height - 2,
      (node.width - 2) / 2,
      false,
      fill,
      undefined,
      undefined,
      stroke,
      1.5,
      false,
      scale
    ));
    (yield* drawRoundedShapeSteps(
      rgba,
      frameW,
      frameH,
      node.x + 6,
      node.y + 6,
      node.width - 12,
      node.height - 12,
      (node.width - 12) / 2,
      false,
      stroke,
      undefined,
      undefined,
      stroke,
      1,
      false,
      scale
    ));
    return;
  }

  const isDiamond = node.shape === "diamond";
  if (node.shadow && node.shape !== "cylinder") {
    (yield* drawShadowSteps(
      rgba,
      frameW,
      frameH,
      node.x,
      node.y,
      node.width,
      node.height,
      node.rx,
      isDiamond,
      shadowColor,
      scale
    ));
  }

  if (node.shape === "hexagon") {
    const inset = 13 * scale;
    const x = node.x * scale;
    const y = node.y * scale;
    const w = node.width * scale;
    const h = node.height * scale;
    const cy = y + h / 2;
    const hexPts: Point[] = [
      { x: x + inset, y },
      { x: x + w - inset, y },
      { x: x + w, y: cy },
      { x: x + w - inset, y: y + h },
      { x: x + inset, y: y + h },
      { x, y: cy }
    ];
    (yield* drawPolygon4x4Steps(rgba, frameW, frameH, hexPts, fill, stroke, node.strokeWidth * scale));
  } else if (node.shape === "cylinder") {
    const x = node.x;
    const y = node.y;
    const w = node.width;
    const h = node.height;
    const ry = Math.min(11, Math.max(9, Math.round(w * 0.075)));
    const steps = 32;
    const cylOuterPts: Point[] = [];
    for (let s = 0; s <= steps; s++) {
      if (++work % 4096 === 0) yield;

      const theta = Math.PI * (s / steps);
      cylOuterPts.push({
        x: (x + (w / 2) * (1 - Math.cos(theta))) * scale,
        y: (y + ry * (1 - Math.sin(theta))) * scale
      });
    }
    for (let s = 0; s <= steps; s++) {
      if (++work % 4096 === 0) yield;

      const theta = Math.PI * (s / steps);
      cylOuterPts.push({
        x: (x + (w / 2) * (1 + Math.cos(theta))) * scale,
        y: (y + h - ry + ry * Math.sin(theta)) * scale
      });
    }
    (yield* drawPolygon4x4Steps(rgba, frameW, frameH, cylOuterPts, fill, stroke, node.strokeWidth * scale));

    const isDarkBody = fill.r < 128;
    const lidFill: RgbaColor = isDarkBody
      ? { r: Math.min(255, fill.r + 18), g: Math.min(255, fill.g + 28), b: Math.min(255, fill.b + 58), a: fill.a }
      : { r: Math.max(0, fill.r - 24), g: Math.max(0, fill.g - 14), b: Math.max(0, fill.b - 4), a: fill.a };
    const lidPts: Point[] = [];
    for (let s = 0; s <= steps; s++) {
      if (++work % 4096 === 0) yield;

      const theta = (Math.PI * 2 * s) / steps;
      lidPts.push({
        x: (x + w / 2 + (w / 2) * Math.cos(theta)) * scale,
        y: (y + ry + ry * Math.sin(theta)) * scale
      });
    }
    (yield* drawPolygon4x4Steps(rgba, frameW, frameH, lidPts, lidFill, stroke, node.strokeWidth * scale));
  } else {
    (yield* drawRoundedShapeSteps(
      rgba,
      frameW,
      frameH,
      node.x,
      node.y,
      node.width,
      node.height,
      node.rx,
      isDiamond,
      fill,
      node.headerFill ? parseCssColor(node.headerFill) : undefined,
      node.headerHeight,
      stroke,
      node.strokeWidth,
      false,
      scale
    ));
  }

  for (const div of node.dividers) {
    if (++work % 4096 === 0) yield;

    (yield* drawPolyline4x4Steps(
      rgba,
      frameW,
      frameH,
      [
        { x: div.x1 * scale, y: div.y1 * scale },
        { x: div.x2 * scale, y: div.y2 * scale }
      ],
      parseCssColor(div.stroke),
      (node.shape === "subroutine" ? 1.5 : 1) * scale,
      false,
      scale
    ));
  }

  for (const badge of node.badges) {
    if (++work % 4096 === 0) yield;

    (yield* drawRoundedShapeSteps(
      rgba,
      frameW,
      frameH,
      badge.x,
      badge.y,
      badge.width,
      badge.height,
      badge.rx,
      false,
      parseCssColor(badge.fill),
      undefined,
      undefined,
      parseCssColor(badge.stroke),
      1,
      false,
      scale
    ));
    (yield* drawTextLine4x4Steps(rgba, frameW, frameH, badge.text, scale));
  }

  for (const line of node.lines) {
    if (++work % 4096 === 0) yield;

    (yield* drawTextLine4x4Steps(rgba, frameW, frameH, line, scale));
  }
}

export function* rasterizeSceneSteps(
  scene: MermaidScene,
  options?: RasterOptions
): Generator<void, RasterFrame, void> {
  yield;

  let work = 0;

  const userScale = options?.scale ?? 2;
  if (!Number.isFinite(userScale) || userScale <= 0) {
    throw new MermaidError("E_ARGUMENT", "Raster scale factor must be a positive finite number");
  }

  const width = Math.max(1, Math.ceil(scene.width * userScale));
  const height = Math.max(1, Math.ceil(scene.height * userScale));
  const totalPixels = width * height;
  options?.budget?.chargePixels(totalPixels);
  options?.budget?.chargeMemoryBytes(totalPixels * 4);

  const rgba = new Uint8Array(new ArrayBuffer(totalPixels * 4 + height), 0, totalPixels * 4);
  const bg = parseCssColor(scene.backgroundColor);
  if (bg.a > 0) {
    for (let i = 0; i < totalPixels * 4; i += 4) {
      if (++work % 4096 === 0) yield;

      rgba[i] = bg.r;
      rgba[i + 1] = bg.g;
      rgba[i + 2] = bg.b;
      rgba[i + 3] = bg.a;
    }
  }

  // Scale from scene viewBox coordinates into framebuffer pixel coordinates
  const sx = width / scene.viewBox.width;
  const sy = height / scene.viewBox.height;
  const effectiveScale = Math.min(sx, sy);
  const shadowColor = parseCssColor(scene.theme.shadowColor);

  // Participant backgrounds sit behind lifelines; other groups retain their overlay order.
  for (const participantBoxes of [true, false]) {
    if (!participantBoxes) {
      // 2. Lifelines
      for (const life of scene.lifelines) {
        if (++work % 4096 === 0) yield;
    
        (yield* drawPolyline4x4Steps(
          rgba,
          width,
          height,
          [
            { x: life.x * effectiveScale, y: life.y1 * effectiveScale },
            { x: life.x * effectiveScale, y: life.y2 * effectiveScale }
          ],
          parseCssColor(life.stroke),
          1.25 * effectiveScale,
          true,
          effectiveScale
        ));
      }
    }
    // 1. Groups
    for (const group of scene.groups) {
      if ((group.kind === "participantBox") !== participantBoxes) continue;
      if (++work % 4096 === 0) yield;
  
      options?.budget?.chargeWork(32);
      (yield* drawRoundedShapeSteps(
        rgba,
        width,
        height,
        group.x,
        group.y,
        group.width,
        group.height,
        group.rx,
        false,
        parseCssColor(group.fill),
        parseCssColor(group.headerFill),
        group.headerHeight,
        parseCssColor(group.stroke),
        group.strokeWidth,
        group.dashed === true,
        effectiveScale
      ));
      (yield* drawPolyline4x4Steps(
        rgba,
        width,
        height,
        [
          { x: group.x * effectiveScale, y: (group.y + group.headerHeight) * effectiveScale },
          {
            x: (group.x + group.width) * effectiveScale,
            y: (group.y + group.headerHeight) * effectiveScale
          }
        ],
        parseCssColor(group.stroke),
        1 * effectiveScale,
        false,
        effectiveScale
      ));
      (yield* drawTextLine4x4Steps(rgba, width, height, group.label, effectiveScale));
  
      if (group.sectionDividers) {
        for (const div of group.sectionDividers) {
          if (++work % 4096 === 0) yield;
  
          (yield* drawPolyline4x4Steps(
            rgba,
            width,
            height,
            [
              { x: group.x * effectiveScale, y: div.y * effectiveScale },
              { x: (group.x + group.width) * effectiveScale, y: div.y * effectiveScale }
            ],
            parseCssColor(group.stroke),
            1 * effectiveScale,
            true,
            effectiveScale
          ));
          if (div.label) {
            const padX = 6;
            const pillW = Math.ceil(div.label.width + padX * 2);
            (yield* drawRoundedShapeSteps(
              rgba,
              width,
              height,
              div.label.x - padX,
              div.y + 3,
              pillW,
              17,
              4,
              false,
              parseCssColor(scene.theme.surface),
              undefined,
              undefined,
              parseCssColor(scene.theme.border),
              0.75,
              false,
              effectiveScale
            ));
            (yield* drawTextLine4x4Steps(rgba, width, height, div.label, effectiveScale));
          }
        }
      }
    }
  }

  // 3. Activations
  for (const act of scene.activations) {
    if (++work % 4096 === 0) yield;

    (yield* drawRoundedShapeSteps(
      rgba,
      width,
      height,
      act.x,
      act.y,
      act.width,
      act.height,
      2,
      false,
      parseCssColor(act.fill),
      undefined,
      undefined,
      parseCssColor(act.stroke),
      1.25,
      false,
      effectiveScale
    ));
  }

  // 3b. Re-paint sequenceBlock header strips over lifelines and activations so LOOP/ALT/OPT headers stay crisp
  for (const g of scene.groups) {
    if (++work % 4096 === 0) yield;

    if (g.kind === "sequenceBlock" && g.headerFill && g.headerHeight) {
      (yield* drawRoundedShapeSteps(
        rgba,
        width,
        height,
        g.x + 1,
        g.y + 1,
        g.width - 2,
        g.headerHeight,
        Math.max(0, g.rx - 1),
        false,
        parseCssColor(g.headerFill),
        undefined,
        undefined,
        parseCssColor(g.stroke),
        1,
        false,
        effectiveScale
      ));
      (yield* drawTextLine4x4Steps(rgba, width, height, g.label, effectiveScale));
    }
  }

  if (scene.slices?.length) {
    const slices = scene.slices;
    const colors = slices.map(slice => parseCssColor(slice.fill));
    const first = slices[0]!;
    const cx = first.cx * effectiveScale, cy = first.cy * effectiveScale, radius = first.radius * effectiveScale;
    const x0 = Math.max(0, Math.floor(cx - radius)), x1 = Math.min(width - 1, Math.ceil(cx + radius));
    const y0 = Math.max(0, Math.floor(cy - radius)), y1 = Math.min(height - 1, Math.ceil(cy + radius));
    options?.budget?.chargeWork((x1 - x0 + 1) * (y1 - y0 + 1) * 16 * Math.max(1, Math.ceil(Math.log2(slices.length))));
    for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
      let hits = 0, red = 0, green = 0, blue = 0;
      for (const sy of SUB_OFFSETS) for (const sx of SUB_OFFSETS) {
        const dx = px + sx - cx, dy = py + sy - cy;
        if (dx * dx + dy * dy > radius * radius) continue;
        let angle = Math.atan2(dy, dx);
        if (angle < first.startAngle) angle += Math.PI * 2;
        let low = 0, high = slices.length - 1;
        while (low < high) { const mid = (low + high) >>> 1; if (angle < slices[mid]!.endAngle) high = mid; else low = mid + 1; }
        const color = colors[low]!;
        red += color.r; green += color.g; blue += color.b; hits++;
      }
      if (hits) blendPixel(rgba, (py * width + px) * 4, { r: red / hits, g: green / hits, b: blue / hits, a: 255 }, hits / 16);
    }
  }

  // 4. Nodes (drawn before edges/markers, matching SVG layer order so node shadows don't darken edges and arrowheads aren't clipped)
  for (const node of scene.nodes) {
    if (++work % 4096 === 0) yield;

    options?.budget?.chargeWork(64);
    (yield* drawNode4x4Steps(rgba, width, height, node, shadowColor, effectiveScale));
  }

  // 5. Edges & markers
  for (const edge of scene.edges) {
    if (++work % 4096 === 0) yield;

    options?.budget?.chargeWork(32);
    const polyPts = flattenSegments(edge.segments, effectiveScale);
    (yield* drawPolyline4x4Steps(
      rgba,
      width,
      height,
      polyPts,
      parseCssColor(edge.stroke),
      edge.strokeWidth * effectiveScale,
      edge.lineStyle === "dotted",
      effectiveScale
    ));
    (yield* drawMarker4x4Steps(rgba, width, height, edge.startMarker, effectiveScale));
    (yield* drawMarker4x4Steps(rgba, width, height, edge.endMarker, effectiveScale));
  }

  // 6. Edge label pills
  for (const edge of scene.edges) {
    if (++work % 4096 === 0) yield;

    if (edge.labelPill) (yield* drawPill4x4Steps(rgba, width, height, edge.labelPill, effectiveScale));
    if (edge.sourceLabelPill)
      (yield* drawPill4x4Steps(rgba, width, height, edge.sourceLabelPill, effectiveScale));
    if (edge.targetLabelPill)
      (yield* drawPill4x4Steps(rgba, width, height, edge.targetLabelPill, effectiveScale));
  }

  // 7. Notes
  for (const note of scene.notes) {
    if (++work % 4096 === 0) yield;

    if (note.shadow) {
      (yield* drawShadowSteps(
        rgba,
        width,
        height,
        note.x,
        note.y,
        note.width,
        note.height,
        note.rx,
        false,
        shadowColor,
        effectiveScale
      ));
    }
    (yield* drawRoundedShapeSteps(
      rgba,
      width,
      height,
      note.x,
      note.y,
      note.width,
      note.height,
      note.rx,
      false,
      parseCssColor(note.fill),
      undefined,
      undefined,
      parseCssColor(note.stroke),
      1.25,
      false,
      effectiveScale
    ));
    for (const line of note.lines) {
      if (++work % 4096 === 0) yield;

      (yield* drawTextLine4x4Steps(rgba, width, height, line, effectiveScale));
    }
  }

  return {
    rgba,
    width,
    height,
    scale: userScale
  };
}

export function rasterizeScene(scene: MermaidScene, options?: RasterOptions): RasterFrame {
  return drainWork(rasterizeSceneSteps(scene, options));
}
