import { createMagickRandom } from "./random.js";
import { virtualPixelIndex } from "./virtual-pixel.js";
import type { RgbaColor, RgbaImage, StoredRgbaImage } from "@poe-code/image-ast/portable";
import type { ConvolveRequest } from "./convolve-kernel.js";
import type { VirtualPixelMethod } from "./warp-kernel.js";

export function parseLocalThresholdGeometry(raw: string): { width: number; height: number; offset: number } {
    const percent = raw.includes("%");
    const value = [...raw].filter(character => character.trim() !== "" && !"%!<>^@#()".includes(character)).join("");
    const parts: string[] = [];
    let start = 0;
    for (let i = 0; i < value.length; i++) {
        if ((value[i] === "+" || value[i] === "-") && value[i - 1]?.toLowerCase() !== "e") {
            parts.push(value.slice(start, i));
            start = i;
        }
    }
    parts.push(value.slice(start));
    const dimensions = parts[0]!.replaceAll("X", "x").replaceAll(",", "x").replaceAll("/", "x").replaceAll(":", "x").split("x");
    let width = Number(dimensions[0]), height = dimensions[1] ? Number(dimensions[1]) : 1;
    const offsets = parts.slice(1).map(part => part === "+" || part === "-" ? 0 : Number(part));
    if (dimensions.length > 2 || !dimensions.some(part => part.length > 0) || offsets.length > 2
        || ![width, height, ...offsets].every(Number.isFinite) || width < 0 || height < 0) throw new Error("Invalid local threshold geometry");
    if (value.includes(":")) {
        width /= height;
        height = 1;
    }
    // Native casts the window dimensions to size_t and uses only the first offset.
    width = Math.trunc(width);
    height = Math.trunc(height);
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width > 1000 || height > 1000) throw new Error("Local threshold window exceeds limit");
    const offset = offsets[0] ?? 0;
    return { width, height, offset: percent ? offset * 65535 / 100 : offset };
}

/** Sliding neighborhood sums over unclipped working samples with bounded source blocks. */
export function* localThresholdPixelSteps(image: Pick<RgbaImage, "width" | "height" | "hasAlpha" | "space" | "hueSamples" | "evaluateSamples"> & Partial<Pick<StoredRgbaImage, "storedHueSamples" | "storedEvaluateSamples">>, geometry: ReturnType<typeof parseLocalThresholdGeometry>, background: RgbaColor, method: VirtualPixelMethod = "edge", channels?: { r: boolean; g: boolean; b: boolean; a: boolean; k?: boolean }, seed?: bigint): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const { width, height } = image, rx = Math.floor(geometry.width / 2), ry = Math.floor(geometry.height / 2);
    const cmyk = image.space === "cmyk", stride = cmyk ? 5 : 4;
    const hue = image.space !== "cmyk" && (!!image.hueSamples || image.storedHueSamples !== undefined);
    const evaluate = !hue && image.space !== "cmyk" && (!!image.evaluateSamples || image.storedEvaluateSamples !== undefined);
    const maximum = hue ? 1 : 65535, offset = geometry.offset * maximum / 65535;
    const mask = channels ? [channels.r, channels.g, channels.b, channels.a, channels.k] : [true, true, true, image.hasAlpha, true];
    // Gray's projected RGB samples share the logical red/gray channel.
    if (image.space === "b-w" || image.space === "grey16") mask[1] = mask[2] = mask[0]!;
    const random = method === "random" ? createMagickRandom(seed) : undefined;
    const blocks = new Map<number, Uint16Array | Float64Array>();
    const gray = method === "white" ? maximum : method === "gray" ? maximum / 2 : 0;
    const fill = (method === "background" || method?.endsWith("-tile"))
        ? [background.r, background.g, background.b, background.a].map(value => value * maximum / 255)
        : [gray, gray, gray, method === "transparent" ? 0 : maximum];
    if (cmyk) fill.push(gray);
    function* sample(x: number, y: number): Generator<ConvolveRequest | undefined, ArrayLike<number>, Uint8Array | undefined> {
        if (x < 0 || y < 0 || x >= width || y >= height) {
            const index = virtualPixelIndex(x, y, width, height, method, random);
            if (index >= 0) {
                x = index % width; y = Math.floor(index / width);
            } else return fill;
        }
        // Four Float64 samples per pixel must fit within a 16 KiB storage read.
        const position = y * width + x, start = Math.floor(position / 512) * 512;
        let samples = blocks.get(start);
        if (!samples) {
            const length = Math.min(512, width * height - start) * 4;
            const bytes = yield { kind: "read", hue, evaluate, highDepth: true, position: start * 4, length };
            if (!bytes || bytes.length !== length * (hue || evaluate ? 8 : 2)) throw new Error("Truncated local threshold pixels");
            samples = hue ? new Float64Array(bytes.slice().buffer)
                : evaluate ? Float64Array.from(new Float64Array(bytes.slice().buffer), value => value * 257)
                : new Uint16Array(bytes.slice().buffer);
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
        // Native realizes a row-major virtual rectangle once per output row.
        // Keep column sums so sliding windows reuse the same random border pixels.
        const columns = random && area > 0 ? new Float64Array((width + geometry.width) * stride) : undefined;
        if (columns) {
            for (let row = 0; row < geometry.height; row++) {
                for (let column = 0; column < width + geometry.width; column++) {
                    if (++work % 4096 === 0) yield;
                    const pixel = yield* sample(column - rx, y + row - ry);
                    for (let c = 0; c < stride; c++) columns[column * stride + c]! += pixel[c]!;
                }
            }
        }
        for (let left = 0; left < width; left += 1024) {
            yield;
            const count = Math.min(1024, width - left), data = hue || cmyk || evaluate ? new Float64Array(count * stride) : new Uint16Array(count * stride);
            for (let i = 0; i < count; i++) {
                const x = left + i;
                if (columns) {
                    for (let c = 0; c < stride; c++) {
                        if (x === 0) {
                            for (let column = 0; column < geometry.width; column++) sums[c]! += columns[column * stride + c]!;
                        } else sums[c]! += columns[(x + geometry.width - 1) * stride + c]! - columns[(x - 1) * stride + c]!;
                    }
                } else for (let row = 0; row < geometry.height; row++) {
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
                for (let c = 0; c < stride; c++) data[i * stride + c] = mask[c] && area > 0 ? (pixel[c]! > sums[c]! / area + offset ? maximum : 0) : pixel[c]!;
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
            if (hue) yield { kind: "write", hue: true, position, data: new Uint8Array(data.buffer) };
            if (evaluate) yield { kind: "write", evaluate: true, position, data: new Uint8Array(Float64Array.from(data, value => value / 257).buffer) };
            const bounded = hue || evaluate ? Uint16Array.from(data, value => Math.round(Math.max(0, Math.min(maximum, value)) * 65535 / maximum)) : data;
            yield { kind: "write", highDepth: true, position, data: new Uint8Array(bounded.buffer) };
        }
    }
}
