/** Resolve ImageMagick's radial extent before applying explicit axis radii. */
export function gradientRadii(width: number, height: number, extent?: string, radii?: string): [number, number] {
    const halfWidth = (width - 1) / 2, halfHeight = (height - 1) / 2;
    const radius = extent === "minimum" ? Math.min(halfWidth, halfHeight)
        : extent === "diagonal" ? Math.hypot(halfWidth, halfHeight)
        : Math.max(halfWidth, halfHeight);
    let rx = extent === "ellipse" ? halfWidth : radius;
    let ry = extent === "ellipse" ? halfHeight : radius;
    if (radii !== undefined) {
        const values = radii.replaceAll(",", " ").split(" ").filter(Boolean);
        const x = Number.parseFloat(values[0] ?? "");
        const y = Number.parseFloat(values[1] ?? "");
        if (Number.isFinite(x)) rx = x;
        // Native scanning stops at a suffix such as "x1" before reading a second radius.
        if (Number.isFinite(Number(values[0])) && Number.isFinite(y)) ry = y;
    }
    return [Math.max(Math.abs(rx), 1e-12), Math.max(Math.abs(ry), 1e-12)];
}
