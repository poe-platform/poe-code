import type { ConvolveRequest } from "./convolve-kernel.js";

/** Separable à trous hat transform with native noise thresholds and reflected edges. */
export function* waveletDenoisePixelSteps(image: { width: number; height: number }, geometry: string): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const [thresholdText = "", softnessText = "0", ...extra] = geometry.replaceAll("%", "").split("x");
    const scale = geometry.includes("%") ? 65535 / 100 : 1;
    const threshold = Number(thresholdText) * scale;
    const softness = Number(softnessText) * scale;
    if (!thresholdText.trim() || !Array.from(thresholdText.trim()).every(char => "0123456789.eE+-".includes(char)) || extra.length || !Number.isFinite(threshold) || !Number.isFinite(softness)) throw new Error("Invalid wavelet denoise geometry");
    const { width, height } = image, size = width * height;
    const noise = [0.8002, 0.2735, 0.1202, 0.0585, 0.0291];
    let levels = 5;
    while (levels > 0 && 2 ** (levels - 1) >= Math.min(width, height)) levels--;
    const output = new Uint8Array(size * 4);
    for (let start = 0; start < size; start += 1024) {
        yield;
        const count = Math.min(1024, size - start);
        const bytes = yield { kind: "read", position: start * 4, length: count * 4 };
        if (!bytes || bytes.length !== count * 4) throw new Error("Truncated wavelet pixels");
        output.set(bytes, start * 4);
    }
    if (threshold !== 0 && levels > 0) {
        const planes = new Float32Array(size * 3), row = new Float32Array(Math.max(width, height));
        for (let channel = 0; channel < 3; channel++) {
            for (let i = 0; i < size; i++) {
                if (i % 1024 === 0) yield;
                planes[i] = output[i * 4 + channel]! * 257;
            }
            let high = 0, low = 0;
            for (let level = 0; level < levels; level++) {
                low = size * ((level & 1) + 1);
                const scale = 2 ** level;
                for (const vertical of [false, true]) {
                    const extent = vertical ? height : width, lines = vertical ? width : height, stride = vertical ? width : 1;
                    for (let line = 0; line < lines; line++) {
                        const base = vertical ? line : line * width, source = vertical ? low : high;
                        for (let i = 0; i < extent; i++) {
                            if (i % 1024 === 0) yield;
                            const left = i < scale ? scale - i : i - scale;
                            const right = i + scale < extent ? i + scale : 2 * extent - 2 - i - scale;
                            row[i] = 0.25 * Math.fround(Math.fround(2 * planes[source + base + i * stride]! + planes[source + base + left * stride]!) + planes[source + base + right * stride]!);
                        }
                        for (let i = 0; i < extent; i++) planes[low + base + i * stride] = row[i]!;
                    }
                }
                const magnitude = threshold * Math.fround(noise[level]!);
                for (let i = 0; i < size; i++) {
                    if (i % 1024 === 0) yield;
                    let detail = Math.fround(planes[high + i]! - planes[low + i]!);
                    if (detail < -magnitude) detail = Math.fround(detail + Math.fround(magnitude * (1 - softness)));
                    else if (detail > magnitude) detail = Math.fround(detail - Math.fround(magnitude * (1 - softness)));
                    else detail = Math.fround(detail * Math.fround(softness));
                    planes[high + i] = detail;
                    if (high !== 0) planes[i]! += detail;
                }
                high = low;
            }
            for (let i = 0; i < size; i++) {
                if (i % 1024 === 0) yield;
                output[i * 4 + channel] = Math.max(0, Math.min(255, Math.round((planes[i]! + planes[low + i]!) / 257)));
            }
        }
    }
    for (let position = 0; position < output.length; position += 4096) {
        yield;
        yield { kind: "write", position, data: output.slice(position, position + 4096) };
    }
}
