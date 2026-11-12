/** MVG strokes are filled outlines, with butt endpoints and joined corners. */
export function* strokeOutline(points: readonly { readonly x: number; readonly y: number }[], width: number, join: string, limit: number, closed: boolean): Generator<undefined, string, void> {
    const vertices = points.filter((p, i) => i === 0 || p.x !== points[i - 1]!.x || p.y !== points[i - 1]!.y);
    if (closed && vertices.length > 1 && vertices[0]!.x === vertices.at(-1)!.x && vertices[0]!.y === vertices.at(-1)!.y) vertices.pop();
    if (vertices.length < 2 || width <= 0) return "";
    // Native round joins trace back to the second vertex, including the final turn.
    if (join === "round" && !closed && vertices.length > 2) vertices.push(vertices[1]!);
    const radius = width / 2;
    const sides: string[][] = [];
    for (const side of [1, -1]) {
        const outline: string[] = [];
        for (let i = 0; i < vertices.length; i++) {
            yield;
            const p = vertices[i]!;
            const previous = vertices[(i + vertices.length - 1) % vertices.length]!;
            const next = vertices[(i + 1) % vertices.length]!;
            const incoming = [p.x - previous.x, p.y - previous.y];
            const outgoing = [next.x - p.x, next.y - p.y];
            const before = Math.hypot(...incoming), after = Math.hypot(...outgoing);
            const a = [-incoming[1]! / before * side, incoming[0]! / before * side];
            const b = [-outgoing[1]! / after * side, outgoing[0]! / after * side];
            const add = (x: number, y: number) => outline.push(`${p.x + radius * x},${p.y + radius * y}`);
            if (!closed && i === 0) { add(b[0]!, b[1]!); continue; }
            if (!closed && i === vertices.length - 1) { add(a[0]!, a[1]!); continue; }
            const dot = a[0]! * b[0]! + a[1]! * b[1]!;
            const cross = a[0]! * b[1]! - a[1]! * b[0]!;
            const ratio = Math.sqrt(2 / Math.max(0, 1 + dot));
            if (dot > -1 + 1e-12 && (cross * side >= 0 || join === "miter") && 2 * ratio <= limit) {
                add((a[0]! + b[0]!) / (1 + dot), (a[1]! + b[1]!) / (1 + dot));
            } else if (join === "round" && (cross * side < 0 || dot < -1 + 1e-12 && side === -1)) {
                const start = Math.atan2(a[1]!, a[0]!);
                const angle = Math.atan2(cross, dot);
                const segments = Math.ceil(Math.abs(angle) / (2 / Math.sqrt(radius)));
                for (let segment = 0; segment < segments; segment++) {
                    const offset = Math.abs(angle) * segment / segments;
                    yield;
                    add(Math.cos(start + Math.sign(angle) * offset), Math.sin(start + Math.sign(angle) * offset));
                }
                add(b[0]!, b[1]!);
            } else {
                add(a[0]!, a[1]!);
                add(b[0]!, b[1]!);
            }
        }
        sides.push(outline);
    }
    if (closed) return `M ${sides[0]!.join(" L ")} Z M ${sides[1]!.reverse().join(" L ")} Z`;
    return `M ${[...sides[0]!, ...sides[1]!.reverse()].join(" L ")} Z`;
}
