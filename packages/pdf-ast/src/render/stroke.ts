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
export interface StrokePointStore {
  readonly length: number;
  get(index: number): Generator<null, StrokePoint, void>;
  push(point: StrokePoint): Generator<null, void, void>;
  trimLast(): void;
  create(): StrokePointStore;
}
export type StrokePoints = readonly StrokePoint[] | StrokePointStore;
type MutableStrokePoints = StrokePoint[] | StrokePointStore;
export function* strokePointAt(points: StrokePoints, index: number): Generator<null, StrokePoint, void> {
  return "get" in points ? yield* points.get(index) : points[index]!;
}
export function createStrokePoints(points: StrokePoints): MutableStrokePoints {
  return "create" in points ? points.create() : [];
}
export function* appendStrokePoint(points: MutableStrokePoints, point: StrokePoint): Generator<null, void, void> {
  if ("get" in points) yield* points.push(point);
  else points.push(point);
}
export interface StrokeSubpath {
  readonly points: StrokePoints;
  readonly closed: boolean;
  /** Distinguishes a dash dot from an explicitly degenerate input path. */
  readonly zeroLengthDash?: boolean;
}

// Bounds both dash expansion and the generated outline for a single paint.
const MAX_STROKE_VERTICES = 1_000_000;

/** Yield runs as they finish. Closed paths replay once to put the wrapped run
 * first, retaining only first/last run descriptors instead of every dash. */
function* dashRuns(path: StrokeSubpath, pattern: readonly number[], phase: number): Generator<StrokeSubpath | null> {
  const cycle = pattern.reduce((sum, value) => sum + value, 0);
  if (!(cycle > 0)) { yield path; return; }
  let offset = ((phase % cycle) + cycle) % cycle, index = 0;
  while (offset > 0) {
    if (offset < pattern[index]!) break;
    offset -= pattern[index]!; index = (index + 1) % pattern.length;
  }
  let remaining = pattern[index]! - offset, steps = 0;
  let current = createStrokePoints(path.points);
  function* flush(): Generator<StrokeSubpath | null> {
    if (current.length) yield { points: current, closed: false };
    current = createStrokePoints(path.points);
  }
  function* advance(point: StrokePoint): Generator<StrokeSubpath | null> {
    while (remaining <= 0) {
      if (++steps > MAX_STROKE_VERTICES) throw new PdfError("E_LIMIT", "Stroke dash expansion exceeds the vertex limit");
      if (index % 2 === 0) {
        if (pattern[index] === 0) {
          const dot = createStrokePoints(path.points);
          yield* appendStrokePoint(dot, point); yield* appendStrokePoint(dot, point);
          yield {points:dot,closed:false,zeroLengthDash:true};
        }
        yield* flush();
      }
      index = (index + 1) % pattern.length; remaining = pattern[index]!;
    }
  }
  const length = path.points.length;
  for (let i = 1; i < length + (path.closed ? 1 : 0); i++) {
    const start = yield* strokePointAt(path.points, i - 1), end = yield* strokePointAt(path.points, i % length);
    const dx = end[0] - start[0], dy = end[1] - start[1], distanceTotal = Math.hypot(dx, dy);
    if (!Number.isFinite(distanceTotal) || distanceTotal / cycle * pattern.length > MAX_STROKE_VERTICES) throw new PdfError("E_LIMIT", "Stroke dash expansion exceeds the vertex limit");
    let distance = 0;
    while (distanceTotal - distance > 8 * Number.EPSILON * Math.max(1, distanceTotal)) {
      const point: StrokePoint = [start[0] + dx * distance / distanceTotal, start[1] + dy * distance / distanceTotal];
      yield* advance(point);
      const step = Math.min(remaining, distanceTotal - distance);
      if (distance + step === distance || ++steps > MAX_STROKE_VERTICES) throw new PdfError("E_LIMIT", "Stroke dash expansion exceeds the vertex limit");
      distance += step; remaining -= step;
      if (index % 2 === 0) {
        if (!current.length) yield* appendStrokePoint(current, point);
        yield* appendStrokePoint(current, [start[0] + dx * distance / distanceTotal, start[1] + dy * distance / distanceTotal]);
      }
    }
  }
  yield* flush();
}
function* dashSubpath(path: StrokeSubpath, pattern: readonly number[], phase: number): Generator<StrokeSubpath | null> {
  if (!path.closed || !(pattern.reduce((sum, value) => sum + value, 0) > 0)) { yield* dashRuns(path, pattern, phase); return; }
  let first: StrokeSubpath | undefined, last: StrokeSubpath | undefined, count = 0;
  for (const run of dashRuns(path, pattern, phase)) {
    if (run === null) { yield null; continue; }
    first ??= run; last = run; count++;
  }
  if (!first || !last) return;
  const start = yield* strokePointAt(path.points, 0), firstPoint = yield* strokePointAt(first.points, 0);
  const lastPoint = yield* strokePointAt(last.points, last.points.length - 1);
  const merge = firstPoint[0] === start[0] && firstPoint[1] === start[1] && lastPoint[0] === start[0] && lastPoint[1] === start[1];
  if (merge) {
    if (count === 1) { yield {points:first.points,closed:true}; return; }
    const points = createStrokePoints(path.points);
    for (let i = 0; i < last.points.length; i++) yield* appendStrokePoint(points, yield* strokePointAt(last.points, i));
    for (let i = 1; i < first.points.length; i++) yield* appendStrokePoint(points, yield* strokePointAt(first.points, i));
    yield {points,closed:false};
  }
  let index = 0;
  for (const run of dashRuns(path, pattern, phase)) {
    if (run === null) { yield null; continue; }
    if (!merge || (index > 0 && index < count - 1)) yield run;
    index++;
  }
}

/** Generate AGG stroke points in device coordinates; undefined ends a contour.
 * Null suspends work while a replayable subpath source supplies caller-backed input.
 * Generated outlines and dash runs stream; normalization uses the input point
 * store's backing policy. Existing vertex admission applies to both routes. */
export function* strokeOutlinePoints(
  paths: Iterable<StrokeSubpath | null>, width: number, cap: 0 | 1 | 2,
  join: 0 | 1 | 2, miterLimit: number, dashArray: readonly number[] = [], dashPhase = 0
): Generator<StrokePoint | undefined | null, void, void> {
  const half = width / 2;
  const pattern = dashArray.length % 2 ? [...dashArray, ...dashArray] : dashArray;
  let count = 0;
  function* add(x: number, y: number): Generator<StrokePoint, void, void> {
    if (++count > MAX_STROKE_VERTICES) throw new PdfError("E_LIMIT", "Stroke outline exceeds the vertex limit");
    yield [x, y];
  };
  function* arc(point: StrokePoint, dx1: number, dy1: number, dx2: number, dy2: number): Generator<StrokePoint, void, void> {
    let a1 = Math.atan2(dy1, dx1), a2 = Math.atan2(dy2, dx2);
    const ccw = a1 - a2 > 0 && a1 - a2 < Math.PI;
    const step = Math.acos(half / (half + 0.125)) * 2;
    yield* add(point[0] + dx1, point[1] + dy1);
    if (step > 0) {
      if (!ccw) {
        if (a1 > a2) a2 += 2 * Math.PI;
        a2 -= step / 4;
        if ((a2 - a1) / step > MAX_STROKE_VERTICES - count) throw new PdfError("E_LIMIT", "Stroke arc exceeds the vertex limit");
        for (a1 += step; a1 < a2; a1 += step) yield* add(point[0] + half * Math.cos(a1), point[1] + half * Math.sin(a1));
      } else {
        if (a1 < a2) a2 -= 2 * Math.PI;
        a2 += step / 4;
        if ((a1 - a2) / step > MAX_STROKE_VERTICES - count) throw new PdfError("E_LIMIT", "Stroke arc exceeds the vertex limit");
        for (a1 -= step; a1 > a2; a1 -= step) yield* add(point[0] + half * Math.cos(a1), point[1] + half * Math.sin(a1));
      }
    }
    yield* add(point[0] + dx2, point[1] + dy2);
  };
  function* addCap(point: StrokePoint, next: StrokePoint): Generator<StrokePoint, void, void> {
    const length = Math.hypot(next[0] - point[0], next[1] - point[1]);
    const dx = half * (next[1] - point[1]) / length;
    const dy = half * (next[0] - point[0]) / length;
    if (cap !== 1) {
      const sx = cap === 2 ? dy : 0, sy = cap === 2 ? dx : 0;
      yield* add(point[0] - dx - sx, point[1] + dy - sy);
      yield* add(point[0] + dx - sx, point[1] - dy - sy);
    } else {
      const angle = Math.atan2(dy, -dx);
      const step = Math.max(0.001, Math.acos(half / (half + 0.125)) * 2);
      yield* add(point[0] - dx, point[1] + dy);
      for (let a = angle + step; a < angle + Math.PI - step / 4; a += step) yield* add(point[0] + half * Math.cos(a), point[1] + half * Math.sin(a));
      yield* add(point[0] + dx, point[1] - dy);
    }
  };
  function* addJoin(prev: StrokePoint, point: StrokePoint, next: StrokePoint): Generator<StrokePoint, void, void> {
    const len1 = Math.hypot(point[0] - prev[0], point[1] - prev[1]);
    const len2 = Math.hypot(next[0] - point[0], next[1] - point[1]);
    const dx1 = half * (point[1] - prev[1]) / len1, dy1 = half * (point[0] - prev[0]) / len1;
    const dx2 = half * (next[1] - point[1]) / len2, dy2 = half * (next[0] - point[0]) / len2;
    const inner = (next[0] - point[0]) * (point[1] - prev[1]) - (next[1] - point[1]) * (point[0] - prev[0]) > 0;
    if (!inner && join === 1) {
      yield* arc(point, dx1, -dy1, dx2, -dy2);
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
          yield* add(x, y);
          return;
        }
      } else if (((bx - prev[0]) * dy1 - (prev[1] - by) * dx1 < 0) !== ((bx - next[0]) * dy1 - (next[1] - by) * dx1 < 0)) {
        yield* add(bx, by);
        return;
      }
    }
    // PDFium maps PDF miter joins to miter_join_revert: bevel at the limit.
    yield* add(point[0] + dx1, point[1] - dy1);
    yield* add(point[0] + dx2, point[1] - dy2);
  };
  for (const path of paths) {
    if (path === null) { yield null; continue; }
    for (const subpath of pattern.length ? dashSubpath(path, pattern, dashPhase) : [path]) {
      if (subpath === null) { yield null; continue; }
      const points = createStrokePoints(subpath.points);
      let previous: StrokePoint | undefined;
      for (let i = 0; i < subpath.points.length; i++) {
        const point = yield* strokePointAt(subpath.points, i);
        if (!previous || Math.hypot(previous[0] - point[0], previous[1] - point[1]) > 1e-14) {
          yield* appendStrokePoint(points, point); previous = point;
        }
      }
      let closed = subpath.closed;
      if (closed && points.length > 1) {
        const first = yield* strokePointAt(points, 0), last = yield* strokePointAt(points, points.length - 1);
        if (Math.hypot(first[0] - last[0], first[1] - last[1]) <= 1e-14) {
          if ("trimLast" in points) points.trimLast(); else points.pop();
        }
      }
      if (points.length < 3) closed = false;
      if (points.length === 1 && cap === 2 && subpath.zeroLengthDash) {
        // Canvas/PDF.js uses a user-axis square for a zero-length dash.
        const [x, y] = (yield* strokePointAt(points, 0));
        yield* add(x - half, y - half);
        yield* add(x + half, y - half);
        yield* add(x + half, y + half);
        yield* add(x - half, y + half);
        yield undefined;
      } else if (points.length === 1 && subpath.points.length > 1 && cap === 1) {
        const [x, y] = (yield* strokePointAt(points, 0));
        yield* addCap([x, y], [x + 1, y]);
        yield* addCap([x, y], [x - 1, y]);
        yield undefined;
      } else if (points.length >= 2) {
        if (!closed) yield* addCap((yield* strokePointAt(points, 0)), (yield* strokePointAt(points, 1)));
        for (let i = closed ? 0 : 1; i < points.length - (closed ? 0 : 1); i++) {
          yield* addJoin((yield* strokePointAt(points, (i + points.length - 1) % points.length)), (yield* strokePointAt(points, i)), (yield* strokePointAt(points, (i + 1) % points.length)));
        }
        if (closed) {
          yield undefined;
        } else yield* addCap((yield* strokePointAt(points, points.length - 1)), (yield* strokePointAt(points, points.length - 2)));
        for (let i = points.length - (closed ? 1 : 2); i >= (closed ? 0 : 1); i--) {
          yield* addJoin((yield* strokePointAt(points, (i + 1) % points.length)), (yield* strokePointAt(points, i)), (yield* strokePointAt(points, (i + points.length - 1) % points.length)));
        }
        yield undefined;
      }
    }
  }
}

/** Buffered convenience adapter for callers that need complete contours. */
export function strokeOutlines(
  paths: readonly StrokeSubpath[], width: number, cap: 0 | 1 | 2,
  join: 0 | 1 | 2, miterLimit: number, dashArray: readonly number[] = [], dashPhase = 0
): StrokePoint[][] {
  const contours: StrokePoint[][] = [];
  let contour: StrokePoint[] = [];
  for (const point of strokeOutlinePoints(paths, width, cap, join, miterLimit, dashArray, dashPhase)) {
    if (point === null) throw new Error("Stored stroke points require an asynchronous driver");
    if (point) contour.push(point);
    else {contours.push(contour); contour = [];}
  }
  return contours;
}
