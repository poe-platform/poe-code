import type { RgbaColor, RgbaImage, StoredRgbaImage } from "@poe-code/image-ast/portable";
import type { ConvolveRequest } from "./convolve-kernel.js";
import { virtualPixelIndex } from "./virtual-pixel.js";
import type { VirtualPixelMethod } from "./warp-kernel.js";

export function parseLocalContrastGeometry(raw: string): { radius: number; strength: number } {
    const parts = raw.replaceAll("%", "").replaceAll("(", "").replaceAll(")", "")
        .replaceAll(",", "x").replaceAll("/", "x").split("x");
    const radius = parts[0] ? Number(parts[0]) : 10;
    const strength = parts[1] ? Number(parts[1]) : 12.5;
    if (parts.length > 2 || !parts.some(part => part.trim().length) || ![radius, strength].every(Number.isFinite)) throw new Error("Invalid local contrast geometry");
    return { radius, strength };
}

/** Native luminance mask: separable weighted passes, float intermediates, RGB gain. */
export function* localContrastPixelSteps(image: Pick<RgbaImage, "width" | "height" | "data16"> & Partial<Pick<StoredRgbaImage, "storedData16">>, geometry: ReturnType<typeof parseLocalContrastGeometry>, background: RgbaColor, virtualPixel: VirtualPixelMethod = "edge", channels?: { r: boolean; g: boolean; b: boolean; a: boolean }): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const { width, height } = image, size = width * height, highDepth = !!(image.data16 || image.storedData16);
    const radius = Math.trunc(Math.max(width, height) * 0.002 * Math.abs(geometry.radius));
    if (radius > 5000) throw new Error("Local contrast radius exceeds 5000");
    const luma = new Float32Array(size), vertical = new Float32Array(size);
    for (let start = 0; start < size; start += 1024) {
        yield;
        const count = Math.min(1024, size - start);
        const bytes = yield { kind: "read", highDepth: true, position: start * 4, length: count * 4 };
        if (!bytes || bytes.length !== count * 8) throw new Error("Truncated local contrast pixels");
        const samples = new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
        for (let i = 0; i < count; i++) luma[start + i] = samples[i * 4]! * 0.212656 + samples[i * 4 + 1]! * 0.715158 + samples[i * 4 + 2]! * 0.072186;
    }
    const gray = virtualPixel === "white" ? 255 : virtualPixel === "gray" ? 128 : 0;
    const fill = virtualPixel === "background" || virtualPixel.endsWith("-tile") ? background : { r: gray, g: gray, b: gray };
    const backgroundLuma = Math.fround((fill.r * 0.212656 + fill.g * 0.715158 + fill.b * 0.072186) * 257);
    const totalWeight = Math.fround((radius + 1) ** 2);
    let work = 0;
    if (geometry.strength !== 0 && radius > 0) for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        let sum = 0;
        // LocalContrastImage omits the final two taps of the triangular window.
        for (let k = 0; k < radius * 2 - 1; k++) {
            if (work++ % 1024 === 0) yield;
            const index = virtualPixelIndex(x, y + k - radius, width, height, virtualPixel);
            sum += (k < radius ? k + 1 : radius * 2 + 1 - k) * (index < 0 ? backgroundLuma : luma[index]!);
        }
        vertical[y * width + x] = sum / totalWeight;
    }
    const selected = channels ? [channels.r, channels.g, channels.b] : [true, true, true];
    for (let start = 0; start < size; start += 1024) {
        yield;
        const count = Math.min(1024, size - start);
        const bytes = yield { kind: "read", highDepth, position: start * 4, length: count * 4 };
        if (!bytes || bytes.length !== count * 4 * (highDepth ? 2 : 1)) throw new Error("Truncated local contrast pixels");
        const output = highDepth ? new Uint16Array(bytes.slice().buffer) : bytes.slice();
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
                const value = Math.fround(output[i * 4 + c]! * (highDepth ? 1 : 257) * gain);
                output[i * 4 + c] = Math.max(0, Math.min(highDepth ? 65535 : 255, Math.round(value / (highDepth ? 1 : 257))));
            }
        }
        yield { kind: "write", highDepth, position: start * 4, data: new Uint8Array(output.buffer, output.byteOffset, output.byteLength) };
    }
}
