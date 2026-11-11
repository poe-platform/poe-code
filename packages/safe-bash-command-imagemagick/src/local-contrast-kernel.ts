import type { RgbaColor, RgbaImage, StoredRgbaImage } from "@poe-code/image-ast/portable";
import type { ConvolveRequest } from "./convolve-kernel.js";
import { createMagickRandom } from "./random.js";
import { virtualPixelIndex } from "./virtual-pixel.js";
import type { VirtualPixelMethod } from "./warp-kernel.js";

export function parseLocalContrastGeometry(raw: string): { radius: number; strength: number } {
    const defaults = { radius: 10, strength: 12.5 };
    const value = [...raw].filter(c => c.trim() !== "" && !"%!<>#^@()".includes(c)).join("");
    // ParseGeometry drops all fields on unknown characters, including JS binary/octal prefixes.
    if (raw.length >= 4095 || [...value].some(c => !"0123456789eExX+-,/.:".includes(c))) return defaults;
    let position = 0;
    function number(hex = false): number | undefined {
        const start = position;
        if (value[position] === "+" || value[position] === "-") position++;
        const hexadecimal = hex && value.slice(position, position + 2).toLowerCase() === "0x";
        if (hexadecimal) position += 2;
        const digits = hexadecimal ? "0123456789abcdefABCDEF" : "0123456789";
        const first = position;
        while (position < value.length && digits.includes(value[position]!)) position++;
        let count = position - first;
        if (!hexadecimal && value[position] === ".") {
            const fraction = ++position;
            while (position < value.length && digits.includes(value[position]!)) position++;
            count += position - fraction;
        }
        if (!count) { position = start; return undefined; }
        if (!hexadecimal && (value[position] === "e" || value[position] === "E")) {
            const exponent = position++;
            if (value[position] === "+" || value[position] === "-") position++;
            const first = position;
            while (position < value.length && digits.includes(value[position]!)) position++;
            if (position === first) position = exponent;
        }
        return hexadecimal ? Number.parseInt(value.slice(start, position), 16) : Number.parseFloat(value.slice(start, position));
    }
    let radius = number();
    // A number followed directly by offsets is an offset itself, not a radius.
    if (position < value.length && !"xX:,/".includes(value[position]!)) { radius = undefined; position = 0; }
    const separator = value[position];
    let strength: number | undefined;
    if (separator && "xX:,/".includes(separator)) {
        position++;
        if (separator === "," || separator === "/" || (value[position] !== "+" && value[position] !== "-")) strength = number(true);
    }
    let offset: number | undefined, negative = false;
    if (position < value.length && "+-,/:".includes(value[position]!)) {
        if (",/:".includes(value[position]!)) position++;
        while (value[position] === "+" || value[position] === "-") {
            if (value[position] === "-") negative = !negative;
            position++;
        }
        offset = number(true);
    }
    if (value.includes(":") && strength !== undefined) {
        if (radius !== undefined) radius /= Math.abs(strength) < 1e-12 ? (strength < 0 ? -1e-12 : 1e-12) : strength;
        strength = offset === 0 ? 2 : 1;
    }
    if (radius !== undefined && strength === undefined && negative && offset !== undefined) strength = -offset;
    radius ??= defaults.radius;
    strength ??= defaults.strength;
    if (![radius, strength].every(Number.isFinite)) throw new Error("Invalid local contrast geometry");
    return { radius, strength };
}

/** Native luminance mask: separable weighted passes, float intermediates, channel gain. */
export function* localContrastPixelSteps(image: Pick<RgbaImage, "width" | "height" | "space" | "hueSamples" | "evaluateSamples"> & Partial<Pick<StoredRgbaImage, "storedHueSamples" | "storedEvaluateSamples">>, geometry: ReturnType<typeof parseLocalContrastGeometry>, background: RgbaColor, virtualPixel: VirtualPixelMethod = "edge", channels?: { r: boolean; g: boolean; b: boolean; a: boolean }, seed?: bigint): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const { width, height } = image, size = width * height;
    const hue = !!image.hueSamples || image.storedHueSamples !== undefined, cmyk = image.space === "cmyk";
    const evaluate = !hue && (!!image.evaluateSamples || image.storedEvaluateSamples !== undefined);
    const radius = Math.trunc(Math.max(width, height) * 0.002 * Math.abs(geometry.radius));
    if (radius > 5000) throw new Error("Local contrast radius exceeds 5000");
    const luma = new Float32Array(size), vertical = new Float32Array(size);
    for (let start = 0; start < size; start += 512) {
        yield;
        const count = Math.min(512, size - start);
        const bytes = yield { kind: "read", hue, evaluate, highDepth: true, position: start * 4, length: count * 4 };
        if (!bytes || bytes.length !== count * 4 * (hue || evaluate ? 8 : 2)) throw new Error("Truncated local contrast pixels");
        const samples = hue ? new Float64Array(bytes.slice().buffer).map(value => value * 65535) : evaluate ? new Float64Array(bytes.slice().buffer).map(value => value * 257) : new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
        for (let i = 0; i < count; i++) luma[start + i] = samples[i * 4]! * 0.212656 + samples[i * 4 + 1]! * 0.715158 + samples[i * 4 + 2]! * 0.072186;
    }
    const gray = virtualPixel === "white" ? 255 : virtualPixel === "gray" ? 128 : 0;
    const fill = virtualPixel === "background" || virtualPixel.endsWith("-tile") ? background : { r: gray, g: gray, b: gray };
    const backgroundLuma = Math.fround((fill.r * 0.212656 + fill.g * 0.715158 + fill.b * 0.072186) * 257);
    const totalWeight = Math.fround((radius + 1) ** 2);
    const random = virtualPixel === "random" ? createMagickRandom(seed) : undefined;
    let work = 0;
    if (geometry.strength !== 0 && radius > 0) for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        let sum = 0;
        // LocalContrastImage omits the final two taps of the triangular window.
        for (let k = 0; k < radius * 2 - 1; k++) {
            if (work++ % 1024 === 0) yield;
            const index = virtualPixelIndex(x, y + k - radius, width, height, virtualPixel, random);
            sum += (k < radius ? k + 1 : radius * 2 + 1 - k) * (index < 0 ? backgroundLuma : luma[index]!);
        }
        vertical[y * width + x] = sum / totalWeight;
    }
    const selected = channels ? [channels.r, channels.g, channels.b] : [true, true, true];
    for (let start = 0; start < size; start += 512) {
        yield;
        const count = Math.min(512, size - start);
        const bytes = yield { kind: "read", highDepth: true, position: start * 4, length: count * 4 };
        if (!bytes || bytes.length !== count * 8) throw new Error("Truncated local contrast pixels");
        const output = new Uint16Array(bytes.slice().buffer);
        const output8 = new Uint8Array(output.length);
        const workingBytes = hue ? yield { kind: "read", hue: true, position: start * 4, length: count * 4 } : undefined;
        const working = workingBytes ? new Float64Array(workingBytes.slice().buffer) : undefined;
        const evaluateBytes = evaluate ? yield { kind: "read", evaluate: true, position: start * 4, length: count * 4 } : undefined;
        if (evaluate && evaluateBytes?.length !== count * 32) throw new Error("Truncated local contrast samples");
        const samples = evaluateBytes ? new Float64Array(evaluateBytes.slice().buffer) : Float64Array.from(output, value => value / 257);
        if (geometry.strength !== 0) for (let i = 0; i < count; i++) {
            const position = start + i, x = position % width, y = Math.floor(position / width);
            let sum = 0;
            for (let k = 0; k < radius * 2 - 1; k++) {
                if (work++ % 1024 === 0) yield;
                // Horizontal padding reflects around the first/last pixel centers.
                const period = Math.max(1, (width - 1) * 2);
                let sx = ((x + k - radius) % period + period) % period;
                if (sx >= width) sx = period - sx;
                sum += (k < radius ? k + 1 : radius * 2 + 1 - k) * vertical[y * width + sx]!;
            }
            const source = luma[position]!;
            const gain = source === 0 ? 0 : (source + (source - sum / totalWeight) * geometry.strength / 100) / source;
            for (let c = 0; c < 3; c++) if (selected[c]) {
                const value = Math.fround((working ? working[i * 4 + c]! * 65535 : samples[i * 4 + c]! * 257) * gain);
                if (working) working[i * 4 + c] = value / 65535;
                else samples[i * 4 + c] = value / 257;
            }
        }
        if (working) {
            // Working-space channels drive later conversions. CMYK black and alpha
            // are untouched; keep the RGB raster in sync with the adjusted inks.
            for (let i = 0; i < samples.length; i++) samples[i] = working[i]! * 255;
            if (cmyk) for (let i = 0; i < count; i++) {
                for (let c = 0; c < 3; c++) samples[i * 4 + c] = (1 - working[i * 4 + c]!) * (1 - working[i * 4 + 3]!) * 255;
                samples[i * 4 + 3] = output[i * 4 + 3]! / 257;
            }
            yield { kind: "write", hue: true, position: start * 4, data: new Uint8Array(working.buffer) };
        }
        // Keep HDRI samples for later operators; only the integer rasters are bounded.
        yield { kind: "write", evaluate: true, position: start * 4, data: new Uint8Array(samples.buffer) };
        for (let i = 0; i < output.length; i++) {
            output[i] = Math.max(0, Math.min(65535, Math.round(samples[i]! * 257)));
            output8[i] = Math.max(0, Math.min(255, Math.round(samples[i]!)));
        }
        yield { kind: "write", highDepth: true, position: start * 4, data: new Uint8Array(output.buffer, output.byteOffset, output.byteLength) };
        // Round each output depth directly from the calculation, avoiding double rounding.
        yield { kind: "write", position: start * 4, data: output8 };
    }
}
