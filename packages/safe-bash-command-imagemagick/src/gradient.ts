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

/** Preserve native floating-point operation order: endpoint residues are colors. */
export function gradientLinearProjection(x1: number, y1: number, x2: number, y2: number): (column: number, row: number) => number {
    const dx = x2 - x1, dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (!length) return () => 0;
    const reciprocal = 1 / Math.max(length, 1e-12);
    const startX = Math.ceil(x1 - 0.5), startY = Math.ceil(y1 - 0.5);
    return (column, row) => {
        // Native retains the preceding offset at the rounded start pixel.
        if (column === startX && row === startY) column = Math.max(0, column - 1);
        const x = column - x1, y = row - y1;
        const distance = Math.sqrt(x * x + y * y);
        const gamma = 1 / Math.max(length * distance, 1e-12);
        const offset = gamma * (dx * x + dy * y) * distance * reciprocal;
        return Math.max(0, Math.min(1, offset));
    };
}

/** Linear projection matching ImageMagick's gradient endpoints. */
export function gradientProjection(width: number, height: number, direction?: string, angle?: number): (column: number, row: number) => number {
    let x1 = 0, y1 = 0, x2 = height === 1 ? width - 1 : 0, y2 = height - 1;
    if (direction !== undefined) {
        direction = direction.toLowerCase();
        if (["center", "none", "forget", "undefined"].includes(direction)) direction = "southeast";
        x1 = direction.includes("west") ? width - 1 : 0;
        y1 = direction.includes("north") ? height - 1 : 0;
        x2 = direction.includes("east") ? width - 1 : 0;
        y2 = direction.includes("south") ? height - 1 : 0;
    }
    if (angle !== undefined) {
        const radians = (angle - 90) * Math.PI / 180;
        const cosine = Math.cos(radians), sine = Math.sin(radians);
        const distance = Math.abs((width - 1) * cosine) + Math.abs((height - 1) * sine);
        x1 = 0.5 * (width - 1 - distance * cosine);
        y1 = 0.5 * (height - 1 - distance * sine);
        x2 = 0.5 * (width - 1 + distance * cosine);
        y2 = 0.5 * (height - 1 + distance * sine);
    }
    return gradientLinearProjection(x1, y1, x2, y2);
}
