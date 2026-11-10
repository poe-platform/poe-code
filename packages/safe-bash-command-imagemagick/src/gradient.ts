/** Linear projection matching ImageMagick's gradient endpoints. */
export function gradientProjection(width: number, height: number, direction?: string, angle?: number): (column: number, row: number) => number {
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
    if (!span) return () => 0;
    const lengthSquared = x * x + y * y;
    // Round half-pixel ties down despite trigonometric floating-point noise.
    const startX = angle === undefined ? (x < 0 ? width - 1 : 0) : Math.ceil((width - 1 - x * span / lengthSquared) / 2 - 0.5 - 1e-12);
    const startY = angle === undefined ? (y < 0 ? height - 1 : 0) : Math.ceil((height - 1 - y * span / lengthSquared) / 2 - 0.5 - 1e-12);
    const offset = -(Math.min(0, x) * (width - 1) + Math.min(0, y) * (height - 1)) / span;
    x /= span;
    y /= span;
    return (column, row) => {
        // Native retains the preceding offset at the rounded start pixel.
        if (column === startX && row === startY) column = Math.max(0, column - 1);
        return Math.max(0, Math.min(1, offset + column * x + row * y));
    };
}
