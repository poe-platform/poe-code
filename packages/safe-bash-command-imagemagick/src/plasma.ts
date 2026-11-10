import type { RgbaColor } from "@poe-code/image-ast/portable";
import type { ConvolveRequest } from "./convolve-kernel.js";
import { createMagickRandom } from "./random.js";

/** ImageMagick's midpoint displacement, retaining HDRI precision until output. */
export function* plasmaPixelSteps(width: number, height: number, first: RgbaColor, last: RgbaColor, fractal: boolean, seed: bigint): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const pixels = new Float32Array(width * height * 3);
    const a = [first.r, first.g, first.b], b = [last.r, last.g, last.b];
    for (let y = 0; y < height; y++) {
        yield;
        for (let x = 0; x < width; x++) {
            const t = height > 1 ? y / (height - 1) : width > 1 ? x / (width - 1) : 0;
            for (let c = 0; c < 3; c++) pixels[(y * width + x) * 3 + c] = (a[c]! * (1 - t) + b[c]! * t) * 257;
        }
    }
    if (fractal) {
        const random = createMagickRandom(seed);
        for (const x of [0, Math.round((width - 1) / 2), width - 1]) {
            for (const y of [0, Math.round((height - 1) / 2), height - 1]) {
                for (let c = 0; c < 3; c++) pixels[(y * width + x) * 3 + c] = 65535 * random() + 0.5;
            }
        }
    }
    function* subdivide(x1: number, y1: number, x2: number, y2: number, depth: number, attenuate: number, random: () => number): Generator<undefined, boolean, unknown> {
        if (x1 === x2 && y1 === y2) return true;
        const xm = Math.floor((x1 + x2) / 2), ym = Math.floor((y1 + y2) / 2);
        if (depth) {
            const tl = yield* subdivide(x1, y1, xm, ym, depth - 1, attenuate + 1, random);
            const bl = yield* subdivide(x1, ym, xm, y2, depth - 1, attenuate + 1, random);
            const tr = yield* subdivide(xm, y1, x2, ym, depth - 1, attenuate + 1, random);
            const br = yield* subdivide(xm, ym, x2, y2, depth - 1, attenuate + 1, random);
            return tl && bl && tr && br;
        }
        yield;
        const noise = 65535 / (2 * attenuate);
        const displace = (ux: number, uy: number, vx: number, vy: number, x: number, y: number) => {
            for (let c = 0; c < 3; c++) {
                const average = (pixels[(uy * width + ux) * 3 + c]! + pixels[(vy * width + vx) * 3 + c]!) / 2;
                pixels[(y * width + x) * 3 + c] = average + noise * random() - noise / 2;
            }
        };
        if (x1 !== xm || x2 !== xm) {
            displace(x1, y1, x1, y2, x1, ym);
            if (x1 !== x2) displace(x2, y1, x2, y2, x2, ym);
        }
        if (y1 !== ym || y2 !== ym) {
            if (x1 !== xm || y2 !== ym) displace(x1, y2, x2, y2, xm, y2);
            if (y1 !== y2) displace(x1, y1, x2, y1, xm, y1);
        }
        displace(x1, y1, x2, y2, xm, ym);
        return x2 - x1 < 3 && y2 - y1 < 3;
    }
    // Native starts a fresh seeded random stream at each refinement depth.
    for (let depth = 1; ; depth++) {
        if (yield* subdivide(0, 0, width - 1, height - 1, depth, 0, createMagickRandom(seed))) break;
    }
    for (let start = 0; start < width * height; start += 4096) {
        const count = Math.min(4096, width * height - start), samples = new Uint16Array(count * 4);
        for (let i = 0; i < count; i++) {
            for (let c = 0; c < 3; c++) samples[i * 4 + c] = Math.max(0, Math.min(65535, Math.round(pixels[(start + i) * 3 + c]!)));
            samples[i * 4 + 3] = 65535;
        }
        yield { kind: "write", position: start * 4, data: new Uint8Array(samples.buffer), highDepth: true };
    }
}
