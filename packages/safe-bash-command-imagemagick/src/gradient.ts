import type { MagickGeometry } from "./index.js";

export function validateGradientBoundingBox(width: number, height: number, box?: MagickGeometry): void {
    if (!box) return;
    const boxWidth = box.width ?? width;
    const boxHeight = box.height ?? (box.isPercent ? box.width : undefined) ?? height;
    if (box.x < 0 || box.y < 0 || boxWidth <= 0 ||
        (box.y + boxHeight - 1) * width + box.x + boxWidth > width * height) {
        throw new Error("no images for write '-write'");
    }
}

/** Radial gradients use half the directional endpoint as their default center. */
export function gradientCenter(width: number, height: number, direction?: string, center?: { x: number; y?: number }, vector?: string): { x: number; y: number } {
    let x = (width - 1) / 2, y = (height - 1) / 2;
    switch (direction?.replaceAll("-", "")) {
        case "north": case "west": case "northwest": x = 0; y = 0; break;
        case "east": case "northeast": y = 0; break;
        case "south": case "southwest": x = 0; break;
    }
    if (vector !== undefined) {
        const coordinates = vector.replaceAll(",", " ").split(" ").filter(Boolean).map(Number);
        if (coordinates.length === 4 && coordinates.every(Number.isFinite)) {
            x = coordinates[2]! / 2;
            y = coordinates[3]! / 2;
        }
    }
    return { x: center?.x ?? x, y: center?.y ?? y };
}

/** Rotate pixel offsets into the ellipse's axes before measuring radial distance. */
export function gradientRadialProjection(cx: number, cy: number, radii: readonly [number, number], angle = 0): (x: number, y: number) => number {
    const radians = radii[0] === radii[1] ? 0 : angle * Math.PI / 180;
    const cosine = Math.cos(radians), sine = Math.sin(radians);
    return (x, y) => {
        const dx = x - cx, dy = y - cy;
        return Math.min(1, Math.hypot((cosine * dx + sine * dy) / radii[0], (sine * dx - cosine * dy) / radii[1]));
    };
}

/** Linear projection matching ImageMagick's gradient endpoints. */
export function gradientProjection(width: number, height: number, direction?: string, angle?: number): (column: number, row: number) => number {
    let x = 0, y = 1;
    if (direction !== undefined) {
        direction = direction.toLowerCase();
        if (["center", "none", "forget", "undefined"].includes(direction)) direction = "southeast";
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
