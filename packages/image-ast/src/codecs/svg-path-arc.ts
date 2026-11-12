import type { SvgPathPoint } from "./svg-path.js";

/** Trace endpoint-form elliptical arcs with bounded cubic subdivisions. */
export function* svgArcPoints(from: readonly [number, number], end: readonly [number, number], rx: number, ry: number, rotation: number, large: boolean, sweep: boolean): Generator<SvgPathPoint> {
  rx = Math.abs(rx); ry = Math.abs(ry);
  if (![...from, ...end, rx, ry, rotation].every(Number.isFinite)) throw new Error("SVG arc requires finite coordinates");
  if ((Math.abs(from[0] - end[0]) < 1e-12 && Math.abs(from[1] - end[1]) < 1e-12) || rx < 1e-12 || ry < 1e-12) {
    yield end;
    return;
  }
  const radians = rotation % 360 * Math.PI / 180, cosine = Math.cos(radians), sine = Math.sin(radians);
  const dx = cosine * (end[0] - from[0]) / 2 + sine * (end[1] - from[1]) / 2;
  const dy = cosine * (end[1] - from[1]) / 2 - sine * (end[0] - from[0]) / 2;
  const scale = Math.hypot(dx / rx, dy / ry);
  if (scale * scale < 1e-12) { yield end; return; }
  if (scale > 1) { rx *= scale; ry *= scale; }
  const sx = (cosine * from[0] + sine * from[1]) / rx, sy = (cosine * from[1] - sine * from[0]) / ry;
  const ex = (cosine * end[0] + sine * end[1]) / rx, ey = (cosine * end[1] - sine * end[0]) / ry;
  const ax = ex - sx, ay = ey - sy;
  const factor = (sweep === large ? -1 : 1) * Math.sqrt(Math.max(0, 1 / (ax * ax + ay * ay) - 0.25));
  const cx = (sx + ex) / 2 - factor * ay, cy = (sy + ey) / 2 + factor * ax;
  const start = Math.atan2(sy - cy, sx - cx);
  let angle = Math.atan2(ey - cy, ex - cx) - start;
  if (angle < 0 && sweep) angle += 2 * Math.PI;
  else if (angle > 0 && !sweep) angle -= 2 * Math.PI;
  // ImageMagick traces arcs as cubics of at most a quarter turn, then
  // samples each cubic at a bounded rate derived from its control span.
  const segments = Math.ceil(Math.abs(angle) / (Math.PI / 2 + 1e-12));
  const map = (x: number, y: number): readonly [number, number] => [cosine * rx * x - sine * ry * y, sine * rx * x + cosine * ry * y];
  for (let segment = 0; segment < segments; segment++) {
    const a = start + segment * angle / segments, b = start + (segment + 1) * angle / segments;
    const half = (b - a) / 2, gamma = (8 / 3) * Math.sin(half / 2) ** 2 / Math.sin(half);
    const first = map(cx + Math.cos(a) - gamma * Math.sin(a), cy + Math.sin(a) + gamma * Math.cos(a));
    const second = map(cx + Math.cos(b) + gamma * Math.sin(b), cy + Math.sin(b) - gamma * Math.cos(b));
    const to = segment === segments - 1 ? end : map(cx + Math.cos(b), cy + Math.sin(b));
    const span = Math.max(4,
      Math.max(from[0], first[0], second[0], to[0]) - Math.min(from[0], first[0], second[0], to[0]),
      Math.max(from[1], first[1], second[1], to[1]) - Math.min(from[1], first[1], second[1], to[1]));
    const steps = Math.min(200, Math.floor(span / 4)) * 4;
    for (let step = 1; step < steps; step++) {
      const t = step / steps, mt = 1 - t;
      yield [mt ** 3 * from[0] + 3 * mt ** 2 * t * first[0] + 3 * mt * t ** 2 * second[0] + t ** 3 * to[0],
        mt ** 3 * from[1] + 3 * mt ** 2 * t * first[1] + 3 * mt * t ** 2 * second[1] + t ** 3 * to[1]];
    }
    yield to;
    from = to;
  }
}
