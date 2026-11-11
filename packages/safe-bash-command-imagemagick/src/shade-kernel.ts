import type { RgbaColor, RgbaImage, StoredRgbaImage } from "@poe-code/image-ast/portable";
import type { ConvolveRequest } from "./convolve-kernel.js";
import type { VirtualPixelMethod } from "./warp-kernel.js";
import { magickIntensity } from "./intensity.js";
import { virtualPixelIndex } from "./virtual-pixel.js";

/** Directional surface normals from a 3x3 intensity neighborhood. */
export function* shadePixelSteps(image: Pick<RgbaImage, "width" | "height" | "hasAlpha" | "data16" | "space" | "hueSamples"> & Partial<Pick<StoredRgbaImage, "storedData16" | "storedHueSamples">> & { magickColorspace?: string | undefined }, spec: string, argument: number, background: RgbaColor, method: VirtualPixelMethod = "edge", channels?: { r: boolean; g: boolean; b: boolean; a: boolean; k?: boolean }, intensity = "rec709luma"): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
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
    const gray = method === "white" ? 255 : method === "gray" ? 128 : 0;
    const fill = (method === "background" || method.endsWith("-tile") ? [background.r, background.g, background.b, background.a] : [gray, gray, gray, method === "transparent" ? 0 : 255]).map(value => value * quantum / 255);
    const blocks = new Map<number, Uint8Array | Uint16Array | Float64Array>();
    function* sample(x: number, y: number): Generator<ConvolveRequest, ArrayLike<number>, Uint8Array | undefined> {
        const index = virtualPixelIndex(x, y, width, height, method);
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
        const inks = cmyk ? new Float64Array(count * 4) : undefined;
        const alphaBytes = cmyk ? yield { kind: "read", highDepth: true, position: start * 4, length: count * 4 } : undefined;
        const alpha = alphaBytes ? new Uint16Array(alphaBytes.slice().buffer) : undefined;
        for (let i = 0; i < count; i++) {
            yield;
            const x = (start + i) % width, y = Math.floor((start + i) / width);
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
            for (let c = 0; c < 4; c++) data[i * 4 + c] = mask[c] ? Math.fround(shade * 65535 / quantum) / 257 : center[c]! * 255 / quantum;
            if (inks) {
                for (let c = 0; c < 4; c++) inks[i * 4 + c] = (c === 3 ? !channels || channels.k : mask[c])
                    ? Math.fround(shade * 65535 / quantum) / 65535 : center[c]! / quantum;
                for (let c = 0; c < 3; c++) data[i * 4 + c] = (1 - inks[i * 4 + c]!) * (1 - inks[i * 4 + 3]!) * 255;
                data[i * 4 + 3] = mask[3] ? Math.fround(shade * 65535 / quantum) / 257 : alpha![i * 4 + 3]! / 257;
            }
        }
        if (inks) yield { kind: "write", hue: true, position: start * 4, data: new Uint8Array(inks.buffer) };
        else if (hue) yield { kind: "write", hue: true, position: start * 4, data: new Uint8Array(data.map(value => value / 255).buffer) };
        const encoded = highDepth
            ? Uint16Array.from(data, value => Math.max(0, Math.min(65535, Math.round(value * 257))))
            : Uint8Array.from(data, value => Math.max(0, Math.min(255, Math.round(value))));
        yield { kind: "write", highDepth, position: start * 4, data: new Uint8Array(encoded.buffer) };
        yield { kind: "write", evaluate: true, position: start * 4, data: new Uint8Array(data.buffer) };
    }
}
