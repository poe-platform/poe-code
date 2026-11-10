import { virtualPixelIndex } from "./virtual-pixel.js";
import type { RgbaColor } from "@poe-code/image-ast/portable";
import type { ConvolveRequest } from "./convolve-kernel.js";
import type { VirtualPixelMethod } from "./warp-kernel.js";

export function parseLocalThresholdGeometry(raw: string): { width: number; height: number; offset: number } {
    const percent = raw.endsWith("%"), value = percent ? raw.slice(0, -1) : raw;
    const sign = [...value].findIndex(character => character === "+" || character === "-");
    const dimensions = (sign < 0 ? value : value.slice(0, sign)).split("x");
    const width = Number(dimensions[0]), height = dimensions[1] === undefined ? 1 : Number(dimensions[1]);
    const offset = sign < 0 ? 0 : Number(value.slice(sign));
    if (dimensions.length > 2 || !dimensions.every(part => part.trim().length > 0) || ![width, height].every(Number.isSafeInteger)
        || width < 0 || height < 0 || !Number.isFinite(offset) || (sign >= 0 && sign === value.length - 1)) throw new Error("Invalid local threshold geometry");
    if (width > 1000 || height > 1000) throw new Error("Local threshold window exceeds limit");
    return { width, height, offset: percent ? offset * 65535 / 100 : offset };
}

/** Sliding neighborhood sums with bounded source blocks and Q16 sample precision. */
export function* localThresholdPixelSteps(image: { width: number; height: number; hasAlpha: boolean }, geometry: ReturnType<typeof parseLocalThresholdGeometry>, background: RgbaColor, method: VirtualPixelMethod = "edge", channels?: { r: boolean; g: boolean; b: boolean; a: boolean }): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const { width, height } = image, rx = Math.floor(geometry.width / 2), ry = Math.floor(geometry.height / 2);
    const mask = channels ? [channels.r, channels.g, channels.b, channels.a] : [true, true, true, image.hasAlpha];
    const blocks = new Map<number, Uint16Array>();
    const gray = method === "white" ? 65535 : method === "gray" ? 65535 / 2 : 0;
    const fill = (method === "background" || method?.endsWith("-tile"))
        ? [background.r, background.g, background.b, background.a].map(value => value * 257)
        : [gray, gray, gray, method === "transparent" ? 0 : 65535];
    function* sample(x: number, y: number): Generator<ConvolveRequest | undefined, ArrayLike<number>, Uint8Array | undefined> {
        if (x < 0 || y < 0 || x >= width || y >= height) {
            const index = virtualPixelIndex(x, y, width, height, method);
            if (index >= 0) {
                x = index % width; y = Math.floor(index / width);
            } else return fill;
        }
        const position = y * width + x, start = Math.floor(position / 1024) * 1024;
        let samples = blocks.get(start);
        if (!samples) {
            const length = Math.min(1024, width * height - start) * 4;
            const bytes = yield { kind: "read", highDepth: true, position: start * 4, length };
            if (!bytes || bytes.length !== length * 2) throw new Error("Truncated local threshold pixels");
            samples = new Uint16Array(bytes.slice().buffer);
            if (blocks.size >= 64) blocks.delete(blocks.keys().next().value!);
            blocks.set(start, samples);
        }
        return samples.subarray((position - start) * 4, (position - start + 1) * 4);
    }
    const area = geometry.width * geometry.height;
    let work = 0;
    for (let y = 0; y < height; y++) {
        const sums = [0, 0, 0, 0];
        for (let left = 0; left < width; left += 1024) {
            yield;
            const count = Math.min(1024, width - left), data = new Uint16Array(count * 4);
            for (let i = 0; i < count; i++) {
                const x = left + i;
                for (let row = 0; row < geometry.height; row++) {
                    const first = x === 0 ? -rx : x - rx - 1;
                    const end = x === 0 ? geometry.width - rx : first + 2;
                    for (let column = first; column < end; column++) {
                        if (++work % 4096 === 0) yield;
                        const delta = x === 0 || column !== first ? 1 : -1;
                        const pixel = yield* sample(x === 0 || column === first ? column : x + geometry.width - rx - 1, y + row - ry);
                        for (let c = 0; c < 4; c++) sums[c]! += delta * pixel[c]!;
                    }
                }
                const pixel = yield* sample(x, y);
                for (let c = 0; c < 4; c++) data[i * 4 + c] = mask[c] && area > 0 ? (pixel[c]! > sums[c]! / area + geometry.offset ? 65535 : 0) : pixel[c]!;
            }
            yield { kind: "write", highDepth: true, position: (y * width + left) * 4, data: new Uint8Array(data.buffer) };
        }
    }
}
