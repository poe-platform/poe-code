/** ImageMagick vector placement, including its radial center and start-pixel rule. */
export function gradientVector(width: number, height: number, value: string | undefined, radial: boolean, radii?: readonly [number, number]): ((x: number, y: number) => number) | undefined {
    if (value === undefined) return undefined;
    const coordinates = value.replaceAll(",", " ").split(" ").filter(Boolean).slice(0, 4).map(Number);
    if (coordinates.length === 0 || !coordinates.every(Number.isFinite)) return undefined;
    const [x1 = 0, y1 = 0, x2 = width - 1, y2 = height - 1] = coordinates;
    const dx = x2 - x1, dy = y2 - y1;
    const lengthSquared = dx * dx + dy * dy;
    const radius = Math.max(width - 1, height - 1) / 2;
    const startX = Math.ceil(x1 - 0.5), startY = Math.ceil(y1 - 0.5);
    return (x, y) => {
        // Native retains the preceding offset at the rounded start pixel.
        if (x === startX && y === startY) x = Math.max(0, x - 1);
        const t = radial
            ? Math.hypot((x - x2 / 2) / (radii?.[0] ?? (radius || 1e-12)), (y - y2 / 2) / (radii?.[1] ?? (radius || 1e-12)))
            : lengthSquared === 0 ? 0 : ((x - x1) * dx + (y - y1) * dy) / lengthSquared;
        return Math.max(0, Math.min(1, t));
    };
}
