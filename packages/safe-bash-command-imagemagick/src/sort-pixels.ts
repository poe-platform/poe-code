import type { ConvolveRequest } from "./convolve-kernel.js";
import { magickIntensity } from "./intensity.js";

// Stable merge sort uses one scanline of pixels and yields during wide-row work.
export function* sortPixelSteps(image: { width: number; height: number; space?: string | undefined; magickColorspace?: string | undefined }, method: string, mask = false): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const { width, height } = image;
    const colorspace = image.magickColorspace ?? (image.space === "cmyk" ? "CMYK" : "sRGB");
    // Native luminance decodes gamma only for sRGB/Gray, not other working spaces.
    const linear = method === "rec601luminance" || method === "rec709luminance"
        ? colorspace !== "sRGB" && colorspace !== "Gray"
        : colorspace === "RGB";
    const row = new Uint16Array(width * 4), intensities = new Float64Array(width);
    // 512 RGBA float pixels fit the 16 KiB paged-storage read limit.
    const working: { hue?: Float64Array; evaluate?: Float64Array } = {};
    let order = new Uint32Array(width), scratch = new Uint32Array(width);
    for (let y = 0; y < height; y++) {
        // Derive order from image 0, then optionally emit the mask from image 1.
        for (let source = 0; source < (mask ? 2 : 1); source++) {
            for (let left = 0; left < width; left += 512) {
                yield;
                const count = Math.min(512, width - left);
                const bytes = yield { kind: "read", image: source, highDepth: true, position: (y * width + left) * 4, length: count * 4 };
                if (!bytes || bytes.length !== count * 8) throw new Error("Truncated sort pixels");
                row.set(new Uint16Array(bytes.slice().buffer), left * 4);
                for (const plane of ["hue", "evaluate"] as const) {
                    const samples = yield { kind: "read", image: source, [plane]: true, position: (y * width + left) * 4, length: count * 4 };
                    if (!samples?.length) { delete working[plane]; continue; }
                    if (samples.length !== count * 32) throw new Error("Truncated sort pixels");
                    working[plane] ??= new Float64Array(width * 4);
                    working[plane].set(new Float64Array(samples.slice().buffer), left * 4);
                }
                if (source !== 0) continue;
                const samples = working.hue ?? working.evaluate ?? row;
                const quantum = working.hue ? 1 : working.evaluate ? 255 : 65535;
                for (let x = left; x < left + count; x++) {
                    order[x] = x;
                    intensities[x] = magickIntensity(samples[x * 4]!, samples[x * 4 + 1]!, samples[x * 4 + 2]!, method, quantum, linear);
                }
            }
        }
        for (let size = 1; size < width; size *= 2) {
            for (let start = 0; start < width; start += size * 2) {
                const middle = Math.min(start + size, width), end = Math.min(start + size * 2, width);
                let left = start, right = middle;
                for (let x = start; x < end; x++) {
                    if (x % 1024 === 0) yield;
                    scratch[x] = right >= end || left < middle && intensities[order[left]!]! <= intensities[order[right]!]!
                        ? order[left++]! : order[right++]!;
                }
            }
            [order, scratch] = [scratch, order];
        }
        for (let left = 0; left < width; left += 512) {
            yield;
            const count = Math.min(512, width - left), output = new Uint16Array(count * 4);
            for (let x = 0; x < count; x++) {
                const source = order[left + x]! * 4;
                output.set(row.subarray(source, source + 4), x * 4);
            }
            yield { kind: "write", highDepth: true, position: (y * width + left) * 4, data: new Uint8Array(output.buffer) };
            // Keep every working plane in the same order as RGBA for later operations.
            for (const plane of ["hue", "evaluate"] as const) {
                const samples = working[plane];
                if (!samples) continue;
                const output = new Float64Array(count * 4);
                for (let x = 0; x < count; x++) {
                    const source = order[left + x]! * 4;
                    output.set(samples.subarray(source, source + 4), x * 4);
                }
                yield { kind: "write", [plane]: true, position: (y * width + left) * 4, data: new Uint8Array(output.buffer) };
            }
        }
    }
}
