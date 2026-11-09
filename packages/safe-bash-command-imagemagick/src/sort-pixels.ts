import type { ConvolveRequest } from "./convolve-kernel.js";
import { magickIntensity } from "./intensity.js";

// Stable merge sort uses one scanline of pixels and yields during wide-row work.
export function* sortPixelSteps(image: { width: number; height: number; magickColorspace?: string | undefined }, method: string): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const { width, height } = image;
    const row = new Uint16Array(width * 4), intensities = new Float64Array(width);
    let order = new Uint32Array(width), scratch = new Uint32Array(width);
    for (let y = 0; y < height; y++) {
        for (let left = 0; left < width; left += 1024) {
            yield;
            const count = Math.min(1024, width - left);
            const bytes = yield { kind: "read", highDepth: true, position: (y * width + left) * 4, length: count * 4 };
            if (!bytes || bytes.length !== count * 8) throw new Error("Truncated sort pixels");
            row.set(new Uint16Array(bytes.slice().buffer), left * 4);
            for (let x = left; x < left + count; x++) {
                order[x] = x;
                intensities[x] = magickIntensity(row[x * 4]!, row[x * 4 + 1]!, row[x * 4 + 2]!, method, 65535, image.magickColorspace === "RGB");
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
        for (let left = 0; left < width; left += 1024) {
            yield;
            const count = Math.min(1024, width - left), output = new Uint16Array(count * 4);
            for (let x = 0; x < count; x++) {
                const source = order[left + x]! * 4;
                output.set(row.subarray(source, source + 4), x * 4);
            }
            yield { kind: "write", highDepth: true, position: (y * width + left) * 4, data: new Uint8Array(output.buffer) };
        }
    }
}
