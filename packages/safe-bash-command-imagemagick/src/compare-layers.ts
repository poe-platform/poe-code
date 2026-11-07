import type { RgbaImage, StoredRgbaImage } from "@poe-code/image-ast/portable";
import type { ConvolveRequest } from "./convolve-kernel.js";
import { matchesAlphaFloodfill } from "./floodfill.js";

type Frame = Pick<RgbaImage | StoredRgbaImage, "width" | "height" | "virtualCanvas">;

// Compare the original frames, never the cropped output of the previous step.
export function* compareLayerBounds(previous: Frame, current: Frame, fuzz: number): Generator<
    { image: 0 | 1; position: number; length: number } | undefined,
    { left: number; top: number; width: number; height: number } | undefined,
    Uint8Array | undefined
> {
    let left = current.width, top = current.height, right = -1, bottom = -1;
    const dx = (current.virtualCanvas?.x ?? 0) - (previous.virtualCanvas?.x ?? 0);
    const dy = (current.virtualCanvas?.y ?? 0) - (previous.virtualCanvas?.y ?? 0);
    for (let y = 0; y < current.height; y++) {
        for (let x = 0; x < current.width; x += 1024) {
            yield;
            const count = Math.min(1024, current.width - x);
            const data = (yield { image: 1, position: (y * current.width + x) * 4, length: count * 4 })!;
            const start = Math.max(0, x + dx), end = Math.min(previous.width, x + dx + count), py = y + dy;
            const prior = py >= 0 && py < previous.height && end > start
                ? (yield { image: 0, position: (py * previous.width + start) * 4, length: (end - start) * 4 })! : undefined;
            for (let pixel = 0; pixel < count; pixel++) {
                const i = pixel * 4, px = x + pixel + dx, j = (px - start) * 4;
                const inside = prior && px >= start && px < end;
                if (matchesAlphaFloodfill(data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!, inside ? prior[j]! : 0, inside ? prior[j + 1]! : 0, inside ? prior[j + 2]! : 0, inside ? prior[j + 3]! : 0, fuzz)) continue;
                left = Math.min(left, x + pixel); right = Math.max(right, x + pixel);
                top = Math.min(top, y); bottom = y;
            }
        }
    }
    if (right >= left) return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

export function* optimizeTransparencyPixels(previous: Frame, current: Frame, fuzz: number): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const dx = (current.virtualCanvas?.x ?? 0) - (previous.virtualCanvas?.x ?? 0);
    const dy = (current.virtualCanvas?.y ?? 0) - (previous.virtualCanvas?.y ?? 0);
    for (let y = 0; y < current.height; y++) {
        for (let x = 0; x < current.width; x += 1024) {
            yield;
            const count = Math.min(1024, current.width - x), position = (y * current.width + x) * 4;
            const data = new Uint8Array((yield { kind: "read", position, length: count * 4 })!);
            const start = Math.max(0, x + dx), end = Math.min(previous.width, x + dx + count), py = y + dy;
            const prior = py >= 0 && py < previous.height && end > start
                ? (yield { kind: "read", image: 1, position: (py * previous.width + start) * 4, length: (end - start) * 4 })! : undefined;
            for (let pixel = 0; pixel < count; pixel++) {
                const i = pixel * 4, px = x + pixel + dx, j = (px - start) * 4;
                if (prior && px >= start && px < end && matchesAlphaFloodfill(data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!, prior[j]!, prior[j + 1]!, prior[j + 2]!, prior[j + 3]!, fuzz)) data[i + 3] = 0;
            }
            yield { kind: "write", position, data };
        }
    }
}
