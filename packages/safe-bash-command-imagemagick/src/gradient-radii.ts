/** Resolve ImageMagick's radial extent before applying explicit axis radii. */
export function gradientRadii(width: number, height: number, extent?: string, radii?: string): [number, number] {
    const halfWidth = (width - 1) / 2, halfHeight = (height - 1) / 2;
    const radius = extent === "minimum" ? Math.min(halfWidth, halfHeight)
        : extent === "diagonal" ? Math.hypot(halfWidth, halfHeight)
        : Math.max(halfWidth, halfHeight);
    let rx = extent === "ellipse" ? halfWidth : radius;
    let ry = extent === "ellipse" ? halfHeight : radius;
    if (radii !== undefined) {
        const values = radii.replaceAll(",", " ").split(" ").filter(Boolean).map(Number);
        if (values.length >= 1 && values.length <= 2 && values.every(Number.isFinite)) {
            rx = values[0]!;
            if (values.length === 2) ry = values[1]!;
        }
    }
    return [Math.max(Math.abs(rx), 1e-12), Math.max(Math.abs(ry), 1e-12)];
}
