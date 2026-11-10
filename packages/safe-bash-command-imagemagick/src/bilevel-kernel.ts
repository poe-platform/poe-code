import type { ConvolveRequest } from "./convolve-kernel.js";

/** Native BilevelType: Rec709 gray, 2%/1% normalization, then a half-range threshold. */
export function* bilevelPixelSteps(count: number, highDepth: boolean): Generator<ConvolveRequest | undefined, number[], Uint8Array | undefined> {
    const histogram = new Float64Array(65536), sampleBytes = highDepth ? 2 : 1;
    let low = 0, high = 65535;
    let black = false, white = false;
    for (let pass = 0; pass < 2; pass++) {
        for (let first = 0; first < count; first += 4096) {
            yield;
            const size = Math.min(4096, count - first);
            const bytes = yield { kind: "read", position: first * 4 * sampleBytes, length: size * 4 * sampleBytes };
            if (!bytes || bytes.length !== size * 4 * sampleBytes) throw new Error("Truncated bilevel pixels");
            const samples = highDepth ? new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2) : bytes;
            const data = pass ? new Uint8Array(size * 4) : undefined;
            for (let pixel = 0; pixel < size; pixel++) {
                const offset = pixel * 4;
                const gray = Math.round((highDepth ? 1 : 257) * (0.212656 * samples[offset]! + 0.715158 * samples[offset + 1]! + 0.072186 * samples[offset + 2]!));
                if (!data) histogram[gray]!++;
                else {
                    const value = gray > (high > low ? (low + high) / 2 : 65535 / 2) ? 255 : 0;
                    black ||= value === 0;
                    white ||= value === 255;
                    data.fill(value, offset, offset + 3);
                    data[offset + 3] = 255;
                }
            }
            if (data) yield { kind: "write", position: first * 4, data };
        }
        if (pass === 0) {
            let sum = 0;
            for (; low < 65535; low++) { sum += histogram[low]!; if (sum > 0.02 * count) break; }
            sum = 0;
            for (; high > 0; high--) { sum += histogram[high]!; if (sum > 0.01 * count) break; }
        }
    }
    const palette: number[] = [];
    if (black) palette.push(0xff000000);
    if (white) palette.push(0xffffffff);
    return palette;
}
