import type { ConvolveRequest } from "./convolve-kernel.js";
import type { MorphologyRow } from "./morphology-kernel.js";

/** Select whole pixels by Rec.709 luma, retaining the first sample on ties. */
export function* morphologyIntensityPixelSteps(image: { width: number; height: number }, rows: readonly MorphologyRow[], mode: "min" | "max", channels?: readonly boolean[]): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const { width, height } = image, ry = Math.floor(rows.length / 2);
    // Reflected explicit kernels may list offsets backwards; native scans left to right.
    const orderedRows = rows.map(row => typeof row === "number" ? row : [...row].sort((a, b) => a - b));
    let work = 0;
    for (let y = 0; y < height; y++) {
        for (let left = 0; left < width; left += 1024) {
            yield;
            const count = Math.min(1024, width - left), position = (y * width + left) * 4;
            const original = yield { kind: "read", highDepth: true, position, length: count * 4 };
            if (!original || original.length !== count * 8) throw new Error("Truncated morphology pixels");
            const data = new Uint16Array(original.slice().buffer);
            for (let local = 0; local < count; local++) {
                let extreme = mode === "min" ? Infinity : -Infinity;
                for (let row = 0; row < orderedRows.length; row++) {
                    const offsets = orderedRows[row]!;
                    const samples = typeof offsets === "number" ? offsets * 2 + 1 : offsets.length;
                    const sy = Math.max(0, Math.min(height - 1, y + row - ry));
                    for (let sample = 0; sample < samples; sample++) {
                        if (++work % 4096 === 0) yield;
                        const offset = typeof offsets === "number" ? sample - Math.ceil(offsets) : offsets[sample]!;
                        const sx = Math.max(0, Math.min(width - 1, left + local + offset));
                        const bytes = yield { kind: "read", highDepth: true, position: (sy * width + sx) * 4, length: 4 };
                        if (!bytes || bytes.length !== 8) throw new Error("Truncated morphology pixels");
                        const pixel = new Uint16Array(bytes.slice().buffer);
                        const intensity = 0.212656 * pixel[0]! + 0.715158 * pixel[1]! + 0.072186 * pixel[2]!;
                        if (mode === "min" ? intensity < extreme : intensity > extreme) {
                            extreme = intensity;
                            for (let c = 0; c < 4; c++)
                                if (!channels || channels[c]) data[local * 4 + c] = pixel[c]!;
                        }
                    }
                }
            }
            yield { kind: "write", highDepth: true, position, data: new Uint8Array(data.buffer) };
        }
    }
}
