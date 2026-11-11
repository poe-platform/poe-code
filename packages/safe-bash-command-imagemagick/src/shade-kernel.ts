import type { RgbaColor, RgbaImage, StoredRgbaImage } from "@poe-code/image-ast/portable";
import type { ConvolveRequest } from "./convolve-kernel.js";
import type { VirtualPixelMethod } from "./warp-kernel.js";
import { createMagickRandom } from "./random.js";
import { magickIntensity } from "./intensity.js";
import { virtualPixelIndex } from "./virtual-pixel.js";
import { regionContains, type Region } from "./region.js";
import { blendMaskedPixel } from "./write-mask.js";

/** Directional surface normals from a 3x3 intensity neighborhood. */
export function* shadePixelSteps(image: Pick<RgbaImage, "width" | "height" | "hasAlpha" | "data16" | "space" | "hueSamples"> & Partial<Pick<StoredRgbaImage, "storedData16" | "storedHueSamples">> & { magickColorspace?: string | undefined }, spec: string, argument: number, background: RgbaColor, method: VirtualPixelMethod = "edge", channels?: { r: boolean; g: boolean; b: boolean; a: boolean; k?: boolean }, intensity = "rec709luma", seed?: bigint, meta = false): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const geometry = [...spec.toLowerCase()].filter(character => character.trim() && !"()!%<>^@#".includes(character)).join("")
        .replaceAll(",", "x").replaceAll("/", "x").replaceAll(":", "x");
    const fields: string[] = [];
    let start = 0;
    for (let i = 1; i < geometry.length; i++) {
        if ("+-".includes(geometry[i]!) && !"ex".includes(geometry[i - 1]!)) {
            fields.push(geometry.slice(start, i));
            start = i;
        }
    }
    fields.push(geometry.slice(start));
    const angles = fields[0]!.split("x");
    let azimuth = Number(angles[0]), elevation = Number(angles[1]);
    if (angles.length !== 2 || !angles.every(value => value.length) || fields.length > 3
        || ![azimuth, elevation, ...fields.slice(1).map(Number)].every(Number.isFinite)) {
        throw new Error(`invalid argument for option '-shade': ${spec} at CLI arg ${argument}`);
    }
    // Native ParseGeometry treats a colon as a ratio with unit elevation.
    if (spec.includes(":")) {
        azimuth /= Math.abs(elevation) >= 1e-12 ? elevation : elevation < 0 ? -1e-12 : 1e-12;
        elevation = 1;
    }
    const a = azimuth * Math.PI / 180, e = elevation * Math.PI / 180;
    const lightX = Math.cos(a) * Math.cos(e), lightY = Math.sin(a) * Math.cos(e), lightZ = Math.sin(e);
    const { width, height } = image, highDepth = !!(image.data16 || image.storedData16), quantum = highDepth ? 65535 : 255;
    const cmyk = image.space === "cmyk", hue = !!image.hueSamples || image.storedHueSamples !== undefined;
    const mask = channels ? [channels.r, channels.g, channels.b, channels.a && image.hasAlpha] : [true, true, true, image.hasAlpha];
    if (image.space === "b-w" || image.space === "grey16") mask[1] = mask[2] = mask[0]!;
    const gray = method === "white" ? 255 : method === "gray" ? 255 / 2 : 0;
    const fill = (method === "background" || method.endsWith("-tile") ? [background.r, background.g, background.b, background.a] : [gray, gray, gray, method === "transparent" ? 0 : 255]).map(value => value * quantum / 255);
    const random = method === "random" ? createMagickRandom(seed) : undefined;
    const randomPixels = new Map<number, number>();
    const blocks = new Map<number, Uint8Array | Uint16Array | Float64Array>();
    function* sample(x: number, y: number): Generator<ConvolveRequest, ArrayLike<number>, Uint8Array | undefined> {
        const index = randomPixels.get((y + 1) * (width + 2) + x + 1) ?? virtualPixelIndex(x, y, width, height, method, random);
        if (index < 0) return fill;
        const start = Math.floor(index / 1024) * 1024;
        let data = blocks.get(start);
        if (!data) {
            const length = Math.min(1024, width * height - start) * 4;
            const working = yield { kind: "read", hue, evaluate: !hue, position: start * 4, length };
            if (working?.length) data = new Float64Array(working.slice().buffer).map(value => value * quantum / (hue ? 1 : 255));
            else {
                const bytes = yield { kind: "read", highDepth, position: start * 4, length };
                if (!bytes || bytes.length !== length * (highDepth ? 2 : 1)) throw new Error("Truncated shade pixels");
                data = highDepth ? new Uint16Array(bytes.buffer, bytes.byteOffset, length) : bytes;
            }
            if (blocks.size >= 16) blocks.delete(blocks.keys().next().value!);
            blocks.set(start, data);
        }
        return data.subarray((index - start) * 4, (index - start) * 4 + 4);
    }
    for (let start = 0; start < width * height; start += 1024) {
        yield;
        const count = Math.min(1024, width * height - start), data = new Float64Array(count * 4);
        const inks = cmyk && !meta ? new Float64Array(count * 4) : undefined;
        const alphaBytes = cmyk ? yield { kind: "read", highDepth: true, position: start * 4, length: count * 4 } : undefined;
        const alpha = alphaBytes ? new Uint16Array(alphaBytes.slice().buffer) : undefined;
        for (let i = 0; i < count; i++) {
            yield;
            const x = (start + i) % width, y = Math.floor((start + i) / width);
            if (random && x === 0) {
                // Native samples a three-row virtual region once per output row.
                // Reuse border pixels across overlapping neighborhoods in that row.
                randomPixels.clear();
                for (let sy = y - 1; sy <= y + 1; sy++) for (let sx = -1; sx <= width; sx++) {
                    if (sx >= 0 && sx < width && sy >= 0 && sy < height) continue;
                    yield;
                    randomPixels.set((sy + 1) * (width + 2) + sx + 1, virtualPixelIndex(sx, sy, width, height, method, random));
                }
            }
            let nx = 0, ny = 0;
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0) continue;
                const pixel = yield* sample(x + dx, y + dy);
                const luma = Math.max(0, Math.min(1, magickIntensity(pixel[0]!, pixel[1]!, pixel[2]!, intensity, quantum, image.magickColorspace === "RGB" || image.magickColorspace === "scRGB") / quantum));
                nx -= dx * luma;
                ny += dy * luma;
            }
            const shade = quantum * Math.max(0, (nx * lightX + ny * lightY + 2 * lightZ) / Math.sqrt(nx * nx + ny * ny + 4));
            const center = yield* sample(x, y);
            // Retain Q16-HDRI samples for subsequent operations and write-mask blending.
            for (let c = 0; c < 4; c++) data[i * 4 + c] = meta ? c === 3 ? 255 : Math.fround(shade * 65535 / quantum) / 257 : mask[c] ? Math.fround(shade * 65535 / quantum) / 257 : center[c]! * 255 / quantum;
            if (inks) {
                for (let c = 0; c < 4; c++) inks[i * 4 + c] = (c === 3 ? !channels || channels.k : mask[c])
                    ? Math.fround(shade * 65535 / quantum) / 65535 : center[c]! / quantum;
                for (let c = 0; c < 3; c++) data[i * 4 + c] = (1 - inks[i * 4 + c]!) * (1 - inks[i * 4 + 3]!) * 255;
                data[i * 4 + 3] = mask[3] ? Math.fround(shade * 65535 / quantum) / 257 : alpha![i * 4 + 3]! / 257;
            }
        }
        if (inks) yield { kind: "write", hue: true, position: start * 4, data: new Uint8Array(inks.buffer) };
        else if (hue && !meta) yield { kind: "write", hue: true, position: start * 4, data: new Uint8Array(data.map(value => value / 255).buffer) };
        const encoded = highDepth
            ? Uint16Array.from(data, value => Math.max(0, Math.min(65535, Math.round(value * 257))))
            : Uint8Array.from(data, value => Math.max(0, Math.min(255, Math.round(value))));
        yield { kind: "write", highDepth, position: start * 4, data: new Uint8Array(encoded.buffer) };
        yield { kind: "write", evaluate: true, position: start * 4, data: new Uint8Array(data.buffer) };
    }
}

/** Extra planes use the parent image's original and shaded alpha during cache clipping. */
export function* shadeMetaMaskPixelSteps(image: { width: number; height: number; hasAlpha: boolean; alphaBlend?: boolean | undefined; region?: Region | undefined }, mask?: { width: number; height: number }): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x += 512) {
        yield;
        const length = Math.min(512, image.width - x) * 4, position = (y * image.width + x) * 4;
        const samples: Float64Array[] = [];
        for (const source of [0, 1, 2, 3]) {
            const working = yield { kind: "read", evaluate: true, image: source, position, length };
            samples.push(working?.length ? new Float64Array(working.slice().buffer)
                : Float64Array.from(new Uint16Array((yield { kind: "read", highDepth: true, image: source, position, length })!.slice().buffer), value => value / 257));
        }
        const edited = samples[0]!, original = samples[1]!;
        let protection: Float64Array | undefined;
        if (mask) {
            const maskX = Math.min(x, mask.width - 1), maskLength = Math.min(length / 4, mask.width - maskX) * 4;
            const maskPosition = (Math.min(y, mask.height - 1) * mask.width + maskX) * 4;
            const working = yield { kind: "read", evaluate: true, image: 4, position: maskPosition, length: maskLength };
            protection = working?.length ? new Float64Array(working.slice().buffer)
                : Float64Array.from(new Uint16Array((yield { kind: "read", highDepth: true, image: 4, position: maskPosition, length: maskLength })!.slice().buffer), value => value / 257);
        }
        for (let offset = 0; offset < length; offset += 4) {
            original[offset + 3] = samples[2]![offset + 3]!;
            edited[offset + 3] = samples[3]![offset + 3]!;
            if (protection) {
                const m = Math.min(offset, protection.length - 4);
                const intensity = (0.212656 * protection[m]! + 0.715158 * protection[m + 1]! + 0.072186 * protection[m + 2]!) / 255;
                blendMaskedPixel(edited, original, edited, offset, intensity, 255, undefined, image.hasAlpha && image.alphaBlend !== false);
            }
            if (image.region) blendMaskedPixel(edited, original, edited, offset,
                regionContains(image.region, x + offset / 4, y) ? 0 : 1, 255, undefined, image.hasAlpha && image.alphaBlend !== false);
            // Alpha supplies blending context; the extra plane itself remains opaque.
            edited[offset + 3] = 255;
        }
        yield { kind: "write", evaluate: true, position, data: new Uint8Array(edited.buffer) };
        const bounded = Uint16Array.from(edited, value => Math.round(Math.max(0, Math.min(65535, value * 257))));
        yield { kind: "write", highDepth: true, position, data: new Uint8Array(bounded.buffer) };
    }
}
