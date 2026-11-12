export type DrawPoint = readonly [x: number, y: number];

/** Native dash strokes have butt caps and bevel both sides of each join. */
function strokeOutline(points: readonly DrawPoint[], width: number): DrawPoint[] {
    const left: DrawPoint[] = [], right: DrawPoint[] = [];
    let start = points[0]!;
    for (let i = 1; i < points.length; i++) {
        const end = points[i]!, dx = end[0] - start[0], dy = end[1] - start[1];
        const length = Math.hypot(dx, dy);
        if (length < (left.length ? 0.5 : 1e-12)) continue;
        // Native horizontal slopes use a finite reciprocal, which decides
        // coverage at exact half-pixel boundaries.
        const nx = (dy === 0 ? -Math.sign(dx) * 1e-12 : -dy / length) * width / 2;
        const ny = dx / length * width / 2;
        left.push([start[0] + nx, start[1] + ny], [end[0] + nx, end[1] + ny]);
        right.push([start[0] - nx, start[1] - ny], [end[0] - nx, end[1] - ny]);
        start = end;
    }
    return left.concat(right.reverse());
}

export function* dashStrokePolygons(points: readonly DrawPoint[], pattern: readonly number[], offset: number, width: number, scale: number): Generator<DrawPoint[] | undefined> {
    let index = 0, remaining = scale * pattern[0]!;
    offset *= scale;
    width *= scale;
    let dash: DrawPoint[] = [points[0]!];
    // ImageMagick adjusts the first interval by half a pixel only when an
    // offset is present. Negative offsets leave the initial pattern unchanged.
    while (offset > 0 && index < pattern.length) {
        remaining = scale * (pattern[index]! + (index === 0 ? -0.5 : 0.5));
        if (offset < remaining) { remaining -= offset; break; }
        offset -= remaining;
        remaining = scale * (pattern[++index] ?? 0);
        dash = [];
        yield;
    }
    for (let i = 1; i < points.length; i++) {
        yield;
        const start = points[i - 1]!, end = points[i]!;
        const dx = end[0] - start[0], dy = end[1] - start[1], length = Math.hypot(dx, dy);
        if (!Number.isFinite(length)) throw new Error("Drawing requires finite stroke lengths");
        if (remaining < 1e-12) { index = (index + (index < pattern.length ? 1 : 0)) % pattern.length; remaining = scale * pattern[index]!; }
        let travelled = 0;
        while (length >= travelled + remaining) {
            const next = travelled + remaining;
            if (next <= travelled) throw new Error("Drawing dash lengths are too small");
            travelled = next;
            const point: DrawPoint = [start[0] + dx * travelled / length, start[1] + dy * travelled / length];
            if (index % 2 === 0) {
                dash.push(point);
                if (dash.length > 1) yield strokeOutline(dash, width);
            } else dash = [point];
            index = (index + 1) % pattern.length;
            remaining = scale * pattern[index]!;
            yield;
        }
        remaining -= length - travelled;
        if (index % 2 === 0) dash.push(end);
        if (i === points.length - 1 && travelled < length && index % 2 === 0 && dash.length > 1) yield strokeOutline(dash, width);
    }
}

export function polygonFillCoverage(points: readonly DrawPoint[], x: number, y: number): number {
    let winding = 0, distance = Infinity;
    for (let i = 0; i < points.length; i++) {
        const a = points[i]!, b = points[(i + 1) % points.length]!;
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const cross = dx * (y - a[1]) - dy * (x - a[0]);
        if (a[1] <= y && b[1] > y && cross > 0) winding++;
        if (a[1] > y && b[1] <= y && cross < 0) winding--;
        // Native edge bounds exclude the leading half-pixel boundary.
        if (x <= Math.min(a[0], b[0]) - 0.5 || x > Math.max(a[0], b[0]) + 0.5 ||
            y <= Math.min(a[1], b[1]) - 0.5 || y > Math.max(a[1], b[1]) + 0.5) continue;
        const squared = dx * dx + dy * dy;
        const t = squared === 0 ? 0 : Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / squared));
        distance = Math.min(distance, Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy));
    }
    return winding !== 0 ? 1 : Math.max(0, 1 - distance) ** 2;
}
