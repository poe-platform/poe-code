import type { RgbaImage, StoredRgbaImage } from "@poe-code/image-ast/portable";
import type { ConvolveRequest } from "./convolve-kernel.js";
import { regionContains, type Region } from "./region.js";
import { matchesAlphaFloodfill } from "./floodfill.js";

type Frame = Pick<RgbaImage | StoredRgbaImage, "width" | "height" | "virtualCanvas">;

// Compare the original frames, never the cropped output of the previous step.
export function* compareLayerBounds(previous: Frame, current: Frame, fuzz: number, method: string): Generator<
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
                if (method === "compareclear") {
                    if (!inside || prior[j + 3]! < 128 || data[i + 3]! >= 128) continue;
                } else {
                    if (method === "compareoverlay" && data[i + 3]! < 128) continue;
                    if (matchesAlphaFloodfill(data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!, inside ? prior[j]! : 0, inside ? prior[j + 1]! : 0, inside ? prior[j + 2]! : 0, inside ? prior[j + 3]! : 0, fuzz)) continue;
                }
                left = Math.min(left, x + pixel); right = Math.max(right, x + pixel);
                top = Math.min(top, y); bottom = y;
            }
        }
    }
    if (right >= left) return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

export function* optimizeTransparencyPixels(previous: Frame, current: Frame & Pick<RgbaImage, "space"> & { region?: Region | undefined }, fuzz: number, mask?: { width: number; height: number }): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const dx = (current.virtualCanvas?.x ?? 0) - (previous.virtualCanvas?.x ?? 0);
    const dy = (current.virtualCanvas?.y ?? 0) - (previous.virtualCanvas?.y ?? 0);
    for (let y = 0; y < current.height; y++) {
        for (let x = 0; x < current.width; x += 1024) {
            yield;
            const count = Math.min(1024, current.width - x), position = (y * current.width + x) * 4;
            const data = new Uint8Array((yield { kind: "read", position, length: count * 4 })!);
            // CMYK uses the fourth working sample for black, not alpha.
            const hue = current.space === "cmyk" ? undefined
                : new Float64Array((yield { kind: "read", hue: true, position, length: count * 4 })!.slice().buffer);
            const start = Math.max(0, x + dx), end = Math.min(previous.width, x + dx + count), py = y + dy;
            const prior = py >= 0 && py < previous.height && end > start
                ? (yield { kind: "read", image: 1, position: (py * previous.width + start) * 4, length: (end - start) * 4 })! : undefined;
            const maskX = mask ? Math.min(x, mask.width - 1) : 0;
            const maskCount = mask ? Math.min(count, mask.width - maskX) : 0;
            const protection = mask ? (yield { kind: "read", image: 2, position: (Math.min(y, mask.height - 1) * mask.width + maskX) * 4, length: maskCount * 4 })! : undefined;
            for (let pixel = 0; pixel < count; pixel++) {
                if (current.region && !regionContains(current.region, x + pixel, y)) continue;
                const m = Math.min(pixel, maskCount - 1) * 4;
                if (protection && 0.212656 * protection[m]! + 0.715158 * protection[m + 1]! + 0.072186 * protection[m + 2]! > 127.5) continue;
                const i = pixel * 4, px = x + pixel + dx, j = (px - start) * 4;
                if (prior && px >= start && px < end && matchesAlphaFloodfill(data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!, prior[j]!, prior[j + 1]!, prior[j + 2]!, prior[j + 3]!, fuzz)) {
                    data[i + 3] = 0;
                    if (hue?.length) hue[i + 3] = 0;
                }
            }
            yield { kind: "write", position, data };
            if (hue?.length) yield { kind: "write", hue: true, position, data: new Uint8Array(hue.buffer) };
        }
    }
}

// Coalesced frames must retain the displayed pixel when its change is within fuzz.
// The encoder can then optimize those pixels using its exact comparisons.
export function* optimizePlusPixels(current: Frame, fuzz: number): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    for (let position = 0; position < current.width * current.height * 4; position += 4096) {
        yield;
        const length = Math.min(4096, current.width * current.height * 4 - position);
        const data = new Uint8Array((yield { kind: "read", position, length })!);
        const prior = (yield { kind: "read", image: 1, position, length })!;
        for (let i = 0; i < length; i += 4) {
            if (matchesAlphaFloodfill(data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!, prior[i]!, prior[i + 1]!, prior[i + 2]!, prior[i + 3]!, fuzz)) {
                data.set(prior.subarray(i, i + 4), i);
            }
        }
        yield { kind: "write", position, data };
    }
}
