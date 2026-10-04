import type { RgbaColor } from "@poe-code/image-ast/portable";
import type { ConvolveRequest } from "./convolve-kernel.js";
export interface ShadowLayout {
    readonly width: number;
    readonly height: number;
    readonly offsetX: number;
    readonly offsetY: number;
    readonly opacity: number;
}
export function* shadowPixelSteps(source: { width: number; height: number }, layout: ShadowLayout, color: RgbaColor): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    for (let y = 0; y < layout.height; y++) for (let left = 0; left < layout.width; left += 1024) {
        yield;
        const count = Math.min(1024, layout.width - left), data = new Uint8Array(count * 4), sy = y - layout.offsetY;
        const first = Math.max(left, layout.offsetX), end = Math.min(left + count, layout.offsetX + source.width);
        if (sy >= 0 && sy < source.height && end > first) {
            const length = (end - first) * 4;
            const bytes = yield { kind: "read", position: (sy * source.width + first - layout.offsetX) * 4, length };
            if (!bytes || bytes.length !== length) throw new Error("Truncated shadow pixels");
            for (let x = first; x < end; x++) {
                const offset = (x - left) * 4;
                data[offset] = color.r; data[offset + 1] = color.g; data[offset + 2] = color.b;
                const value = bytes[(x - first) * 4 + 3]! * layout.opacity;
                data[offset + 3] = Number.isFinite(value) ? Math.max(0, Math.min(255, Math.round(value))) : 0;
            }
        }
        yield { kind: "write", position: (y * layout.width + left) * 4, data };
    }
}
export function* vignettePixelSteps(source: { width: number; height: number }, background: RgbaColor): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const size = source.width * source.height, cx = (source.width - 1) / 2, cy = (source.height - 1) / 2;
    for (let start = 0; start < size; start += 1024) {
        yield;
        const count = Math.min(1024, size - start), bytes = yield { kind: "read", position: start * 4, length: count * 4 };
        if (!bytes || bytes.length !== count * 4) throw new Error("Truncated vignette pixels");
        const data = new Uint8Array(bytes);
        for (let i = 0; i < count; i++) {
            const x = (start + i) % source.width, y = Math.floor((start + i) / source.width);
            const nx = (x - cx) / Math.max(1, cx), ny = (y - cy) / Math.max(1, cy);
            const t = Math.max(0, Math.min(1, (Math.hypot(nx, ny) - 0.65) / 0.55)), offset = i * 4;
            data[offset] = Math.max(0, Math.min(255, Math.round(data[offset]! * (1 - t) + background.r * t)));
            data[offset + 1] = Math.max(0, Math.min(255, Math.round(data[offset + 1]! * (1 - t) + background.g * t)));
            data[offset + 2] = Math.max(0, Math.min(255, Math.round(data[offset + 2]! * (1 - t) + background.b * t)));
        }
        yield { kind: "write", position: start * 4, data };
    }
}

export function* raisePixelSteps(image: { width: number; height: number }, border: number, raised: boolean): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const size = image.width * image.height * 4;
    for (let position = 0; position < size; position += 16384) {
        yield;
        const data = new Uint8Array((yield { kind: "read", position, length: Math.min(16384, size - position) })!);
        for (let offset = 0; offset < data.length; offset += 4) {
            const pixel = (position + offset) / 4, x = pixel % image.width, y = Math.floor(pixel / image.width);
            const topLeft = y < border || x < border, bottomRight = y >= image.height - border || x >= image.width - border;
            if (!topLeft && !bottomRight) continue;
            const delta = (raised ? topLeft : bottomRight) ? 40 : -40;
            for (let channel = 0; channel < 3; channel++) data[offset + channel] = Math.max(0, Math.min(255, data[offset + channel]! + delta));
        }
        yield { kind: "write", position, data };
    }
}
