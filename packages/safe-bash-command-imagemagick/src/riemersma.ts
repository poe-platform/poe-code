import { remapColorOrder } from "./remap.js";
import type { ConvolveRequest } from "./convolve-kernel.js";

/** Hilbert traversal clipped to the image, without scanning empty quadrants. */
export function* hilbertPixels(img: { width: number; height: number }): Generator<number> {
    function* pixels(x: number, y: number, xi: number, yi: number, xj: number, yj: number, size: number): Generator<number> {
        // Skip whole Hilbert quadrants outside a rectangular image.
        if (Math.min(x, x + xi, x + xj, x + xi + xj) >= img.width ||
            Math.min(y, y + yi, y + yj, y + yi + yj) >= img.height ||
            Math.max(x, x + xi, x + xj, x + xi + xj) <= 0 ||
            Math.max(y, y + yi, y + yj, y + yi + yj) <= 0) return;
        if (size === 1) {
            yield (Math.floor(y + (yi + yj) / 2) * img.width + Math.floor(x + (xi + xj) / 2)) * 4;
            return;
        }
        yield* pixels(x, y, xj / 2, yj / 2, xi / 2, yi / 2, size / 2);
        yield* pixels(x + xi / 2, y + yi / 2, xi / 2, yi / 2, xj / 2, yj / 2, size / 2);
        yield* pixels(x + (xi + xj) / 2, y + (yi + yj) / 2, xi / 2, yi / 2, xj / 2, yj / 2, size / 2);
        yield* pixels(x + xi / 2 + xj, y + yi / 2 + yj, -xj / 2, -yj / 2, -xi / 2, -yi / 2, size / 2);
    }
    const extent = 2 ** Math.ceil(Math.log2(Math.max(img.width, img.height, 1)));
    yield* pixels(0, 0, 0, extent, extent, 0, extent);
}

/** ImageMagick Riemersma diffusion: a 16-entry weighted error queue. */
export function* riemersmaRemapSteps(image: { width: number; height: number }, paletteImage: { width: number; height: number }, highDepth: boolean, diffusionAmount: number): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const palette: Uint8Array[] = [], seen = new Set<number>();
    for (let position = 0; position < paletteImage.width * paletteImage.height * 4; position += 4096) {
        yield;
        const length = Math.min(4096, paletteImage.width * paletteImage.height * 4 - position);
        const bytes = (yield { kind: "read", image: 1, position, length })!;
        for (let i = 0; i < bytes.length; i += 4) {
            const key = bytes[i]! << 24 | bytes[i + 1]! << 16 | bytes[i + 2]! << 8 | bytes[i + 3]!;
            if (!seen.has(key)) { seen.add(key); palette.push(bytes.slice(i, i + 4)); }
        }
    }
    palette.sort((a, b) => remapColorOrder(b[0]!, b[1]!, b[2]!) - remapColorOrder(a[0]!, a[1]!, a[2]!));
    const errors = new Float64Array(64);
    const weights = Float64Array.from({ length: 16 }, (_, i) => diffusionAmount * 16 ** (-1 - i / 15));
    let work = 0;
    for (const position of hilbertPixels(image)) {
        if (++work % 1024 === 0) yield;
        const input = (yield { kind: "read", position, length: 4 })!;
        const target = Float64Array.from(input);
        for (let channel = 0; channel < 4; channel++) {
            for (let entry = 0; entry < 16; entry++) target[channel]! += weights[entry]! * errors[entry * 4 + channel]!;
            target[channel] = Math.max(0, Math.min(255, target[channel]!));
        }
        let best = palette[0]!, distance = Infinity;
        for (const color of palette) {
            if (++work % 65536 === 0) yield;
            let next = 0;
            for (let c = 0; c < 4; c++) next += (target[c]! - color[c]!) ** 2;
            if (next < distance) { best = color; distance = next; }
        }
        errors.copyWithin(0, 4);
        for (let c = 0; c < 4; c++) errors[60 + c] = target[c]! - best[c]!;
        yield highDepth
            ? { kind: "write", highDepth: true, position, data: new Uint8Array(Uint16Array.from(best, value => value * 257).buffer) }
            : { kind: "write", position, data: best };
    }
}
