import { virtualPixelIndex } from "./virtual-pixel.js";
import type { RgbaColor, RgbaImage } from "@poe-code/image-ast/portable";
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
export function* localThresholdPixelSteps(image: Pick<RgbaImage, "width" | "height" | "hasAlpha" | "space">, geometry: ReturnType<typeof parseLocalThresholdGeometry>, background: RgbaColor, method: VirtualPixelMethod = "edge", channels?: { r: boolean; g: boolean; b: boolean; a: boolean; k?: boolean }): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const { width, height } = image, rx = Math.floor(geometry.width / 2), ry = Math.floor(geometry.height / 2);
    const cmyk = image.space === "cmyk", stride = cmyk ? 5 : 4;
    const mask = channels ? [channels.r, channels.g, channels.b, channels.a, channels.k] : [true, true, true, image.hasAlpha, true];
    // Gray's projected RGB samples share the logical red/gray channel.
    if (image.space === "b-w" || image.space === "grey16") mask[1] = mask[2] = mask[0]!;
    const blocks = new Map<number, Uint16Array | Float64Array>();
    const gray = method === "white" ? 65535 : method === "gray" ? 65535 / 2 : 0;
    const fill = (method === "background" || method?.endsWith("-tile"))
        ? [background.r, background.g, background.b, background.a].map(value => value * 257)
        : [gray, gray, gray, method === "transparent" ? 0 : 65535];
    if (cmyk) fill.push(0);
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
            if (cmyk) {
                const inkBytes = yield { kind: "read", hue: true, position: start * 4, length };
                if (!inkBytes || inkBytes.length !== length * 8) throw new Error("Truncated local threshold inks");
                const inks = new Float64Array(inkBytes.slice().buffer);
                const workingBytes = yield { kind: "read", evaluate: true, position: start * 4, length };
                const working = workingBytes?.length ? new Float64Array(workingBytes.slice().buffer) : undefined;
                const pixels = new Float64Array(length / 4 * stride);
                for (let i = 0; i < length / 4; i++) pixels.set([
                    inks[i * 4]! * 65535, inks[i * 4 + 1]! * 65535, inks[i * 4 + 2]! * 65535,
                    working ? working[i * 4 + 3]! * 257 : samples[i * 4 + 3]!, inks[i * 4 + 3]! * 65535,
                ], i * stride);
                samples = pixels;
            }
            if (blocks.size >= 64) blocks.delete(blocks.keys().next().value!);
            blocks.set(start, samples);
        }
        return samples.subarray((position - start) * stride, (position - start + 1) * stride);
    }
    const area = geometry.width * geometry.height;
    let work = 0;
    for (let y = 0; y < height; y++) {
        const sums = [0, 0, 0, 0, 0];
        for (let left = 0; left < width; left += 1024) {
            yield;
            const count = Math.min(1024, width - left), data = cmyk ? new Float64Array(count * stride) : new Uint16Array(count * stride);
            for (let i = 0; i < count; i++) {
                const x = left + i;
                for (let row = 0; row < geometry.height; row++) {
                    const first = x === 0 ? -rx : x - rx - 1;
                    const end = x === 0 ? geometry.width - rx : first + 2;
                    for (let column = first; column < end; column++) {
                        if (++work % 4096 === 0) yield;
                        const delta = x === 0 || column !== first ? 1 : -1;
                        const pixel = yield* sample(x === 0 || column === first ? column : x + geometry.width - rx - 1, y + row - ry);
                        for (let c = 0; c < stride; c++) sums[c]! += delta * pixel[c]!;
                    }
                }
                const pixel = yield* sample(x, y);
                for (let c = 0; c < stride; c++) data[i * stride + c] = mask[c] && area > 0 ? (pixel[c]! > sums[c]! / area + geometry.offset ? 65535 : 0) : pixel[c]!;
            }
            const position = (y * width + left) * 4;
            if (cmyk) {
                const inks = new Float64Array(count * 4), rgba = new Float64Array(count * 4);
                for (let i = 0; i < count; i++) {
                    inks.set([data[i * stride]! / 65535, data[i * stride + 1]! / 65535, data[i * stride + 2]! / 65535, data[i * stride + 4]! / 65535], i * 4);
                    for (let c = 0; c < 3; c++) rgba[i * 4 + c] = (1 - inks[i * 4 + c]!) * (1 - inks[i * 4 + 3]!) * 255;
                    rgba[i * 4 + 3] = data[i * stride + 3]! / 257;
                }
                yield { kind: "write", hue: true, position, data: new Uint8Array(inks.buffer) };
                yield { kind: "write", evaluate: true, position, data: new Uint8Array(rgba.buffer) };
                yield { kind: "write", highDepth: true, position, data: new Uint8Array(Uint16Array.from(rgba, value => Math.max(0, Math.min(65535, Math.round(value * 257)))).buffer) };
                continue;
            }
            yield { kind: "write", highDepth: true, position, data: new Uint8Array(data.buffer) };
        }
    }
}
