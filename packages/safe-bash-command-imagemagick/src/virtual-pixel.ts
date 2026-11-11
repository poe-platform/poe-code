import type { VirtualPixelMethod } from "./warp-kernel.js";

// Native DitherX/DitherY use the first eight entries of the ordered dither matrix.
const ditherOffsets = [0, 48, 12, 60, 3, 51, 15, 63];

/** Return a source pixel index, or -1 for a constant virtual pixel. */
export function virtualPixelIndex(x: number, y: number, width: number, height: number, method: VirtualPixelMethod | undefined, random: () => number = Math.random): number {
    if (x >= 0 && y >= 0 && x < width && y < height) return y * width + x;
    const wrap = (value: number, size: number) => ((value % size) + size) % size;
    switch (method) {
        case "dither":
            x = Math.max(0, Math.min(width - 1, x + ditherOffsets[x & 7]! - 32));
            y = Math.max(0, Math.min(height - 1, y + ditherOffsets[y & 7]! - 32));
            break;
        case "random":
            // Native x86_64 evaluates the Y argument before X.
            y = Math.min(height - 1, Math.floor(height * random()));
            x = Math.min(width - 1, Math.floor(width * random()));
            break;
        case "edge":
            x = Math.max(0, Math.min(width - 1, x)); y = Math.max(0, Math.min(height - 1, y));
            break;
        case "mirror":
            x = wrap(x, width * 2); y = wrap(y, height * 2);
            if (x >= width) x = width * 2 - x - 1;
            if (y >= height) y = height * 2 - y - 1;
            break;
        case "checker-tile":
            if ((Math.floor(x / width) + Math.floor(y / height)) % 2 !== 0) return -1;
            x = wrap(x, width); y = wrap(y, height);
            break;
        case "tile":
            x = wrap(x, width); y = wrap(y, height);
            break;
        case "horizontal-tile":
            if (y < 0 || y >= height) return -1;
            x = wrap(x, width);
            break;
        case "vertical-tile":
            if (x < 0 || x >= width) return -1;
            y = wrap(y, height);
            break;
        case "horizontal-tile-edge":
            x = wrap(x, width); y = Math.max(0, Math.min(height - 1, y));
            break;
        case "vertical-tile-edge":
            x = Math.max(0, Math.min(width - 1, x)); y = wrap(y, height);
            break;
        default: return -1;
    }
    return y * width + x;
}
