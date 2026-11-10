import type { ConvolveRequest } from "./convolve-kernel.js";
import { quantizePixelSteps } from "./quantize.js";
import { remapColorOrder } from "./remap.js";
import { hilbertPixels } from "./riemersma.js";

/** GIF's direct-color conversion uses a six-bit nearest-color cache. */
export function* gifDitherSteps(image: { width: number; height: number }, method: "riemersma" | "floydsteinberg", diffusionAmount: number): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const colors = new Map<number, Uint8Array>();
    const quantize = quantizePixelSteps(image.width * image.height * 4, 255);
    let response: Uint8Array | undefined;
    for (;;) {
        const step = quantize.next(response);
        if (step.done) break;
        if (step.value?.kind === "write") {
            const bytes = step.value.data;
            for (let i = 0; i < bytes.length; i += 4) {
                const key = bytes[i]! << 24 | bytes[i + 1]! << 16 | bytes[i + 2]! << 8 | bytes[i + 3]!;
                if (!colors.has(key)) colors.set(key, bytes.slice(i, i + 4));
            }
            response = undefined;
        } else response = yield step.value;
    }
    const palette = [...colors.values()].sort((a, b) => remapColorOrder(b[0]!, b[1]!, b[2]!) - remapColorOrder(a[0]!, a[1]!, a[2]!));
    const cache = new Map<number, Uint8Array>();
    const queue = new Float64Array(64);
    const weights = Float64Array.from({ length: 16 }, (_, i) => diffusionAmount * 16 ** (-1 - i / 15));
    let row = new Float64Array(method === "floydsteinberg" ? image.width * 4 : 0), nextRow = new Float64Array(row.length);
    function* scan() {
        for (let y = 0; y < image.height; y++) {
            for (let x = 0; x < image.width; x++) yield (y * image.width + (y % 2 ? image.width - x - 1 : x)) * 4;
            [row, nextRow] = [nextRow, row];
            nextRow.fill(0);
        }
    }
    let work = 0;
    for (const position of method === "riemersma" ? hilbertPixels(image) : scan()) {
        if (++work % 1024 === 0) yield;
        const input = (yield { kind: "read", position, length: 4 })!;
        const target = Float64Array.from(input), x = position / 4 % image.width;
        // Match the quantizer’s single transparent entry without hidden RGB error.
        if (input[3] === 0) target[0] = target[1] = target[2] = 0;
        let key = 0;
        for (let c = 0; c < 4; c++) {
            if (method === "riemersma") for (let i = 0; i < 16; i++) target[c]! += weights[i]! * queue[i * 4 + c]!;
            else target[c]! += row[x * 4 + c]!;
            target[c] = Math.max(0, Math.min(255, target[c]!));
            key = key * 64 + Math.floor(target[c]! * 257 / 1024);
        }
        let best = cache.get(key);
        if (!best) {
            let distance = Infinity;
            for (const color of palette) {
                let next = 0;
                for (let c = 0; c < 4; c++) next += (target[c]! - color[c]!) ** 2;
                if (next < distance) { best = color; distance = next; }
            }
            cache.set(key, best!);
        }
        if (method === "riemersma") {
            queue.copyWithin(0, 4);
            for (let c = 0; c < 4; c++) queue[60 + c] = target[c]! - best![c]!;
        } else {
            const direction = Math.floor(position / 4 / image.width) % 2 ? -1 : 1;
            for (let c = 0; c < 4; c++) {
                const error = (target[c]! - best![c]!) * diffusionAmount / 16;
                if (x + direction >= 0 && x + direction < image.width) {
                    row[(x + direction) * 4 + c]! += error * 7;
                    nextRow[(x + direction) * 4 + c]! += error;
                }
                if (x - direction >= 0 && x - direction < image.width) nextRow[(x - direction) * 4 + c]! += error * 3;
                nextRow[x * 4 + c]! += error * 5;
            }
        }
        yield { kind: "write", position, data: best! };
    }
}
