export type BoundaryPoint = readonly [x: number, y: number];

/** ImageMagick traces each corner with steps of 1/(8 * max radius). */
export function* roundRectanglePoints(x: number, y: number, x1: number, y1: number, rx: number, ry: number): Generator<undefined, BoundaryPoint[]> {
    if (x1 < x || y1 < y || rx < 0 || ry < 0) throw new Error("Invalid roundrectangle coordinates or radii");
    if (x1 === x || y1 === y || rx === 0 || ry === 0) return [];
    rx = Math.min(rx, (x1 - x) / 2);
    ry = Math.min(ry, (y1 - y) / 2);
    const step = 1 / (8 * Math.max(rx, ry));
    const points: BoundaryPoint[] = [];
    for (const [cx, cy, start] of [[x1 - rx, y + ry, 3], [x1 - rx, y1 - ry, 0], [x + rx, y1 - ry, 1], [x + rx, y + ry, 2]]) {
        const end = (start! + 1) * Math.PI / 2;
        for (let angle = start! * Math.PI / 2; angle < end; angle += step) {
            if (points.length % 1024 === 0) yield;
            if (points.length >= 1048576) throw new Error("Drawing boundary exceeds resource limits");
            points.push([cx! + Math.cos(angle % (2 * Math.PI)) * rx, cy! + Math.sin(angle % (2 * Math.PI)) * ry]);
        }
        points.push([cx! + Math.cos(end % (2 * Math.PI)) * rx, cy! + Math.sin(end % (2 * Math.PI)) * ry]);
    }
    return points;
}

type BoundaryEdge = { points: BoundaryPoint[]; left: number; right: number };

/** Native stroke bounds cover monotonic chains, not individual segments. */
export function* boundaryEdges(points: readonly BoundaryPoint[]): Generator<undefined, BoundaryEdge[]> {
    const edges: BoundaryEdge[] = [];
    let direction = 0, previous = points[0]!;
    let edge: BoundaryEdge = { points: [previous], left: previous[0], right: previous[0] };
    for (let i = 1; i <= points.length; i++) {
        if (i % 1024 === 0) yield;
        const next = points[i % points.length]!;
        if (i < points.length && Math.abs(next[0] - previous[0]) < 1e-12 && Math.abs(next[1] - previous[1]) < 1e-12) continue;
        const nextDirection = next[1] > previous[1] || (Math.abs(next[1] - previous[1]) < 1e-12 && next[0] > previous[0]) ? 1 : -1;
        if (direction && direction !== nextDirection) {
            edges.push(edge);
            edge = { points: [previous], left: previous[0], right: previous[0] };
        }
        edge.points.push(next);
        edge.left = Math.min(edge.left, next[0]); edge.right = Math.max(edge.right, next[0]);
        direction = nextDirection;
        previous = next;
    }
    edges.push(edge);
    return edges;
}

export function* boundaryCoverage(edges: readonly BoundaryEdge[], x: number, y: number, mid: number): Generator<undefined, [fill: number, stroke: number]> {
    let winding = 0, distance = Infinity, work = 0;
    for (const edge of edges) for (let i = 1; i < edge.points.length; i++) {
        if (++work % 1024 === 0) yield;
        const a = edge.points[i - 1]!, b = edge.points[i]!;
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const cross = dx * (y - a[1]) - dy * (x - a[0]);
        if (a[1] <= y && b[1] > y && cross > 0) winding++;
        if (a[1] > y && b[1] <= y && cross < 0) winding--;
        // Native edge bounds include the trailing edge but exclude the leading edge.
        if (x <= edge.left - mid - 0.5 || x > edge.right + mid + 0.5 ||
            y <= Math.min(a[1], b[1]) - mid - 0.5 || y > Math.max(a[1], b[1]) + mid + 0.5) continue;
        const squared = dx * dx + dy * dy;
        const t = squared === 0 ? 0 : Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / squared));
        distance = Math.min(distance, Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy));
    }
    return [winding !== 0 ? 1 : Math.max(0, 1 - distance) ** 2,
        distance <= Math.abs(mid - 0.25) ? 1 : Math.max(0, mid + 0.75 - distance) ** 2];
}
