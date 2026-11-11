import type { ConvolveRequest } from "./convolve-kernel.js";

// Q16 SteganoImage visits successive pixels, cycling RGB and embedding the
// watermark's most significant intensity bits into the carrier's low bits.
export function* steganoPixelSteps(base: { width: number; height: number }, watermark: { width: number; height: number }, offset: number): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const pixels = base.width * base.height, watermarkPixels = watermark.width * watermark.height;
    // ImageMagick wraps at columns squared, even for a non-square carrier.
    const period = base.width * base.width;
    const wraps = period <= pixels && offset >= 0 && offset < period;
    let watermarkStart = -1, watermarkSamples = new Uint16Array();
    for (let start = 0; start < pixels; start += 512) {
        yield;
        const count = Math.min(512, pixels - start);
        const bytes = (yield { kind: "read", highDepth: true, position: start * 4, length: count * 4 })!;
        const samples = new Uint16Array(bytes.slice().buffer);
        for (let bit = 0; bit < (wraps ? 16 : 1); bit++) {
            yield;
            for (let pixel = start; pixel < start + count; pixel++) {
                if (wraps ? pixel >= period : pixel < offset) continue;
                const visit = wraps ? (pixel - offset + period) % period + bit * period : pixel - offset;
                if (visit >= 16 * watermarkPixels) continue;
                const source = visit % watermarkPixels;
                if (source < watermarkStart || source >= watermarkStart + watermarkSamples.length / 4) {
                    watermarkStart = Math.floor(source / 512) * 512;
                    const bytes = (yield { kind: "read", image: 1, highDepth: true, position: watermarkStart * 4,
                        length: Math.min(512, watermarkPixels - watermarkStart) * 4 })!;
                    watermarkSamples = new Uint16Array(bytes.slice().buffer);
                }
                const index = (source - watermarkStart) * 4;
                const intensity = 0.212656 * watermarkSamples[index]! + 0.715158 * watermarkSamples[index + 1]! + 0.072186 * watermarkSamples[index + 2]!;
                const value = (intensity >>> (15 - Math.floor(visit / watermarkPixels))) & 1;
                const channel = (pixel - start) * 4 + visit % 3;
                samples[channel] = (samples[channel]! & ~(1 << bit)) | (value << bit);
            }
        }
        yield { kind: "write", highDepth: true, position: start * 4, data: new Uint8Array(samples.buffer) };
    }
}
