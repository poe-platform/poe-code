/** Linear projection matching ImageMagick's gradient endpoints. */
export function gradientProjection(width: number, height: number, direction?: string, angle?: number): { x: number; y: number; offset: number } {
    let x = 0, y = 1;
    if (direction !== undefined) {
        direction = direction.toLowerCase();
        if (direction === "center") direction = "southeast";
        x = direction.includes("west") ? -1 : direction.includes("east") ? 1 : 0;
        y = direction.includes("north") ? -1 : direction.includes("south") ? 1 : 0;
        if (x && y) { x *= width - 1; y *= height - 1; }
    } else if (height === 1) { x = 1; y = 0; }
    if (angle !== undefined) {
        const radians = angle * Math.PI / 180;
        x = Math.sin(radians);
        y = -Math.cos(radians);
        if (Math.abs(x) < 1e-12) x = 0;
        if (Math.abs(y) < 1e-12) y = 0;
    }
    const span = Math.abs(x) * (width - 1) + Math.abs(y) * (height - 1);
    if (!span) return { x: 0, y: 0, offset: 0 };
    return { x: x / span, y: y / span, offset: -(Math.min(0, x) * (width - 1) + Math.min(0, y) * (height - 1)) / span };
}
