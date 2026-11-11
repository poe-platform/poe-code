import type { RgbaImage } from "@poe-code/image-ast/portable";
import { rgbToCmyk } from "./colorspace-cmyk.js";
import { formatSignificantMetric } from "./compare-kernel.js";

type Chunk = { data: Uint8Array; data16?: Uint16Array; hueSamples?: Float64Array; evaluateSamples?: Float64Array };

/** Native JSON statistics use float quanta, including fractional palette colors. */
export function* jsonStatisticsSteps<Step = never, Resume = void>(
    image: Omit<RgbaImage, "data" | "data16"> & Partial<Pick<RgbaImage, "data" | "data16">>,
    depth: number,
    precision = 6,
    load?: (position: number, length: number) => Generator<Step, Chunk, Resume>
): Generator<Step | undefined, Record<string, Record<string, number>>, Resume> {
    const channels: [string, number][] = image.space === "cmyk" ? [["cyan", 0], ["magenta", 1], ["yellow", 2], ["black", 8]]
        : image.space === "b-w" || image.space === "grey16" ? [["gray", 0]] : [["red", 0], ["green", 1], ["blue", 2]];
    if (image.hasAlpha) channels.unshift(["alpha", 3]);
    const count = image.width * image.height, scale = depth <= 16 ? (2 ** depth - 1) / 65535 : 1;
    const results: Record<string, Record<string, number>> = {};
    const quantum = new Float32Array(1), bits = new Uint32Array(quantum.buffer);
    // Two radix passes find the exact float median without retaining the raster.
    const histogram = new Float64Array(65536), medianBins = new Float64Array(65536);
    for (const [name, channel] of channels) {
        histogram.fill(0); medianBins.fill(0);
        let min = Infinity, max = -Infinity, mean = 0, second = 0, third = 0, fourth = 0;
        let rank = Math.floor((count - 1) / 2), upper = 0;
        for (let pass = 0; pass < 2; pass++) {
            for (let position = 0; position < count * 4; position += 2048) {
                yield;
                const length = Math.min(2048, count * 4 - position);
                const chunk = load ? yield* load(position, length) : {
                    data: image.data!.subarray(position, position + length), data16: image.data16?.subarray(position, position + length),
                    hueSamples: image.hueSamples?.subarray(position, position + length), evaluateSamples: image.evaluateSamples?.subarray(position, position + length)
                };
                for (let i = 0; i < length; i += 4) {
                    const samples = chunk.data16 ?? chunk.data, range = chunk.data16 ? 65535 : 255;
                    const value = image.space === "cmyk" && channel !== 3
                        ? (chunk.hueSamples ? chunk.hueSamples[i + (channel === 8 ? 3 : channel)]!
                            : rgbToCmyk(samples[i]! / range, samples[i + 1]! / range, samples[i + 2]! / range)[channel === 8 ? 3 : channel]!) * 65535
                        : chunk.hueSamples && image.space !== "cmyk" ? chunk.hueSamples[i + channel]! * 65535
                        : chunk.evaluateSamples ? chunk.evaluateSamples[i + channel]! * 257 : samples[i + channel]! * 65535 / range;
                    quantum[0] = value;
                    const sample = quantum[0]!, key = (bits[0]! & 0x80000000 ? ~bits[0]! : bits[0]! ^ 0x80000000) >>> 0;
                    if (pass === 1) {
                        if (key >>> 16 === upper) medianBins[key & 65535]!++;
                        continue;
                    }
                    medianBins[key >>> 16]!++;
                    histogram[Math.max(0, Math.min(65535, Math.round(sample)))]!++;
                    min = Math.min(min, sample); max = Math.max(max, sample);
                    const n = (position + i) / 4 + 1, delta = sample - mean, deltaN = delta / n, term = delta * deltaN * (n - 1);
                    fourth += term * deltaN ** 2 * (n * n - 3 * n + 3) + 6 * deltaN ** 2 * second - 4 * deltaN * third;
                    third += term * deltaN * (n - 2) - 3 * deltaN * second;
                    second += term; mean += deltaN;
                }
            }
            if (pass === 0) {
                for (; upper < 65535 && rank >= medianBins[upper]!; upper++) {
                    if (upper % 8192 === 0) yield;
                    rank -= medianBins[upper]!;
                }
                medianBins.fill(0);
            }
        }
        let lower = 0, distinct = 0, entropy = 0;
        for (; lower < 65535 && rank >= medianBins[lower]!; lower++) {
            if (lower % 8192 === 0) yield;
            rank -= medianBins[lower]!;
        }
        const key = ((upper << 16) | lower) >>> 0;
        bits[0] = key & 0x80000000 ? key ^ 0x80000000 : ~key;
        const median = quantum[0]!;
        for (let bin = 0; bin < histogram.length; bin++) {
            if (bin % 8192 === 0) yield;
            if (!histogram[bin]) continue;
            distinct++;
            const probability = histogram[bin]! / count;
            entropy -= probability * Math.log2(probability);
        }
        const deviation = Math.sqrt(second / Math.max(1, count - 1));
        const metrics = {
            min: Math.fround(Math.max(0, Math.min(65535, min * scale))), max: Math.fround(Math.max(0, Math.min(65535, max * scale))),
            mean: mean * scale, median: median * scale, standardDeviation: deviation * scale,
            kurtosis: deviation ? fourth / count / deviation ** 4 - 3 : 0,
            skewness: deviation ? third / count / deviation ** 3 : 0,
            entropy: distinct > 1 ? entropy / Math.log2(distinct) : 0
        };
        results[name] = Object.fromEntries(Object.entries(metrics).map(([key, value]) => [key, Number(formatSignificantMetric(value, precision))]));
    }
    return results;
}
