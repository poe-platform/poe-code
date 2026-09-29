/*!
 * Anti-Grain Geometry - Version 2.3
 * Copyright (C) 2002-2005 Maxim Shemanarev (http://www.antigrain.com)
 *
 * Permission to copy, use, modify, sell and distribute this software
 * is granted provided this copyright notice appears in all copies.
 * This software is provided "as is" without express or implied
 * warranty, and with no claim as to its suitability for any purpose.
 *
 * Adapted from PDFium agg_math_stroke.h and agg_vcgen_stroke.cpp.
 * See THIRD_PARTY_NOTICES.md for the source revision and adaptations.
 */
import { PdfError } from "../errors.js";

export type StrokePoint = readonly [number, number];
export interface StrokeSubpath {
  readonly points: readonly StrokePoint[];
  readonly closed: boolean;
  /** Distinguishes a dash dot from an explicitly degenerate input path. */
  readonly zeroLengthDash?: boolean;
}

// Bounds both dash expansion and the generated outline for a single paint.
const MAX_STROKE_VERTICES = 1_000_000;

function dashSubpath(path: StrokeSubpath, pattern: readonly number[], phase: number): StrokeSubpath[] {
  const cycle = pattern.reduce((sum, value) => sum + value, 0);
  if (!(cycle > 0)) return [path];
  let offset = ((phase % cycle) + cycle) % cycle, index = 0;
  while (offset > 0) {
    if (offset < pattern[index]!) break;
    offset -= pattern[index]!;
    index = (index + 1) % pattern.length;
  }
  let remaining = pattern[index]! - offset;
  const points = path.closed ? [...path.points, path.points[0]!] : path.points;
  const result: StrokeSubpath[] = [];
  let current: StrokePoint[] = [];
  let steps = 0;
  const flush = () => {
    if (current.length) result.push({ points: current, closed: false });
    current = [];
  };
  const advance = (point: StrokePoint) => {
    while (remaining <= 0) {
      if (++steps > MAX_STROKE_VERTICES) throw new PdfError("E_LIMIT", "Stroke dash expansion exceeds the vertex limit");
      if (index % 2 === 0) {
        if (pattern[index] === 0) result.push({ points: [point, point], closed: false, zeroLengthDash: true });
        flush();
      }
      index = (index + 1) % pattern.length;
      remaining = pattern[index]!;
    }
  };
  for (let i = 1; i < points.length; i++) {
    const start = points[i - 1]!, end = points[i]!;
    const dx = end[0] - start[0], dy = end[1] - start[1];
    const length = Math.hypot(dx, dy);
    if (!Number.isFinite(length) || length / cycle * pattern.length > MAX_STROKE_VERTICES) {
      throw new PdfError("E_LIMIT", "Stroke dash expansion exceeds the vertex limit");
    }
    let distance = 0;
    // A transformed length and a sum of dash steps can differ by a few ULPs.
    // Do not interpret that rounding residue as another terminal dash.
    while (length - distance > 8 * Number.EPSILON * Math.max(1, length)) {
      const point: StrokePoint = [start[0] + dx * distance / length, start[1] + dy * distance / length];
      advance(point);
      const step = Math.min(remaining, length - distance);
      if (distance + step === distance || ++steps > MAX_STROKE_VERTICES) throw new PdfError("E_LIMIT", "Stroke dash expansion exceeds the vertex limit");
      distance += step;
      remaining -= step;
      if (index % 2 === 0) {
        if (!current.length) current.push(point);
        current.push([start[0] + dx * distance / length, start[1] + dy * distance / length]);
      }
    }
  }
  flush();
  if (path.closed && result.length) {
    const first = result[0]!, last = result[result.length - 1]!;
    const start = path.points[0]!;
    const firstPoint = first.points[0]!, lastPoint = last.points[last.points.length - 1]!;
    if (firstPoint[0] === start[0] && firstPoint[1] === start[1] && lastPoint[0] === start[0] && lastPoint[1] === start[1]) {
      if (first === last) result[0] = { points: first.points, closed: true };
      else {
        result[0] = { points: [...last.points, ...first.points.slice(1)], closed: false };
        result.pop();
      }
    }
  }
  return result;
}

/** Generate AGG's two-sided stroke contours in device coordinates. */
export function strokeOutlines(
  paths: readonly StrokeSubpath[], width: number, cap: 0 | 1 | 2,
  join: 0 | 1 | 2, miterLimit: number, dashArray: readonly number[] = [], dashPhase = 0
): StrokePoint[][] {
  const half = width / 2;
  const contours: StrokePoint[][] = [];
  const pattern = dashArray.length % 2 ? [...dashArray, ...dashArray] : dashArray;
  let count = 0;
  let contour: StrokePoint[] = [];
  const add = (x: number, y: number) => {
    if (++count > MAX_STROKE_VERTICES) throw new PdfError("E_LIMIT", "Stroke outline exceeds the vertex limit");
    contour.push([x, y]);
  };
  const arc = (point: StrokePoint, dx1: number, dy1: number, dx2: number, dy2: number) => {
    let a1 = Math.atan2(dy1, dx1), a2 = Math.atan2(dy2, dx2);
    const ccw = a1 - a2 > 0 && a1 - a2 < Math.PI;
    const step = Math.acos(half / (half + 0.125)) * 2;
    add(point[0] + dx1, point[1] + dy1);
    if (step > 0) {
      if (!ccw) {
        if (a1 > a2) a2 += 2 * Math.PI;
        a2 -= step / 4;
        if ((a2 - a1) / step > MAX_STROKE_VERTICES - count) throw new PdfError("E_LIMIT", "Stroke arc exceeds the vertex limit");
        for (a1 += step; a1 < a2; a1 += step) add(point[0] + half * Math.cos(a1), point[1] + half * Math.sin(a1));
      } else {
        if (a1 < a2) a2 -= 2 * Math.PI;
        a2 += step / 4;
        if ((a1 - a2) / step > MAX_STROKE_VERTICES - count) throw new PdfError("E_LIMIT", "Stroke arc exceeds the vertex limit");
        for (a1 -= step; a1 > a2; a1 -= step) add(point[0] + half * Math.cos(a1), point[1] + half * Math.sin(a1));
      }
    }
    add(point[0] + dx2, point[1] + dy2);
  };
  const addCap = (point: StrokePoint, next: StrokePoint) => {
    const length = Math.hypot(next[0] - point[0], next[1] - point[1]);
    const dx = half * (next[1] - point[1]) / length;
    const dy = half * (next[0] - point[0]) / length;
    if (cap !== 1) {
      const sx = cap === 2 ? dy : 0, sy = cap === 2 ? dx : 0;
      add(point[0] - dx - sx, point[1] + dy - sy);
      add(point[0] + dx - sx, point[1] - dy - sy);
    } else {
      const angle = Math.atan2(dy, -dx);
      const step = Math.max(0.001, Math.acos(half / (half + 0.125)) * 2);
      add(point[0] - dx, point[1] + dy);
      for (let a = angle + step; a < angle + Math.PI - step / 4; a += step) add(point[0] + half * Math.cos(a), point[1] + half * Math.sin(a));
      add(point[0] + dx, point[1] - dy);
    }
  };
  const addJoin = (prev: StrokePoint, point: StrokePoint, next: StrokePoint) => {
    const len1 = Math.hypot(point[0] - prev[0], point[1] - prev[1]);
    const len2 = Math.hypot(next[0] - point[0], next[1] - point[1]);
    const dx1 = half * (point[1] - prev[1]) / len1, dy1 = half * (point[0] - prev[0]) / len1;
    const dx2 = half * (next[1] - point[1]) / len2, dy2 = half * (next[0] - point[0]) / len2;
    const inner = (next[0] - point[0]) * (point[1] - prev[1]) - (next[1] - point[1]) * (point[0] - prev[0]) > 0;
    if (!inner && join === 1) {
      arc(point, dx1, -dy1, dx2, -dy2);
      return;
    }
    if (inner || join === 0) {
      const ax = prev[0] + dx1, ay = prev[1] - dy1;
      const bx = point[0] + dx1, by = point[1] - dy1;
      const cx = point[0] + dx2, cy = point[1] - dy2;
      const dx = next[0] + dx2, dy = next[1] - dy2;
      const den = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
      if (Math.abs(den) >= 1e-30) {
        const t = ((ay - cy) * (dx - cx) - (ax - cx) * (dy - cy)) / den;
        const x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
        if (Math.hypot(x - point[0], y - point[1]) <= half * (inner ? 1.01 : miterLimit)) {
          add(x, y);
          return;
        }
      } else if (((bx - prev[0]) * dy1 - (prev[1] - by) * dx1 < 0) !== ((bx - next[0]) * dy1 - (next[1] - by) * dx1 < 0)) {
        add(bx, by);
        return;
      }
    }
    // PDFium maps PDF miter joins to miter_join_revert: bevel at the limit.
    add(point[0] + dx1, point[1] - dy1);
    add(point[0] + dx2, point[1] - dy2);
  };
  for (const path of paths) {
    for (const subpath of pattern.length ? dashSubpath(path, pattern, dashPhase) : [path]) {
      const points: StrokePoint[] = [];
      for (const point of subpath.points) {
        const prev = points[points.length - 1];
        if (!prev || Math.hypot(prev[0] - point[0], prev[1] - point[1]) > 1e-14) points.push(point);
      }
      let closed = subpath.closed;
      if (closed && points.length > 1 && Math.hypot(points[0]![0] - points[points.length - 1]![0], points[0]![1] - points[points.length - 1]![1]) <= 1e-14) points.pop();
      if (points.length < 3) closed = false;
      if (points.length === 1 && cap === 2 && subpath.zeroLengthDash) {
        contour = [];
        // Canvas/PDF.js uses a user-axis square for a zero-length dash.
        const [x, y] = points[0]!;
        add(x - half, y - half);
        add(x + half, y - half);
        add(x + half, y + half);
        add(x - half, y + half);
        contours.push(contour);
      } else if (points.length === 1 && subpath.points.length > 1 && cap === 1) {
        contour = [];
        const [x, y] = points[0]!;
        addCap([x, y], [x + 1, y]);
        addCap([x, y], [x - 1, y]);
        contours.push(contour);
      } else if (points.length >= 2) {
        contour = [];
        if (!closed) addCap(points[0]!, points[1]!);
        for (let i = closed ? 0 : 1; i < points.length - (closed ? 0 : 1); i++) {
          addJoin(points[(i + points.length - 1) % points.length]!, points[i]!, points[(i + 1) % points.length]!);
        }
        if (closed) {
          contours.push(contour);
          contour = [];
        } else addCap(points[points.length - 1]!, points[points.length - 2]!);
        for (let i = points.length - (closed ? 1 : 2); i >= (closed ? 0 : 1); i--) {
          addJoin(points[(i + 1) % points.length]!, points[i]!, points[(i + points.length - 1) % points.length]!);
        }
        contours.push(contour);
      }
    }
  }
  return contours;
}
