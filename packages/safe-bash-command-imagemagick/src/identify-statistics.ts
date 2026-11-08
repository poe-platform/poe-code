import type { RgbaImage, StoredRgbaImage, ImageByteStorage } from "@poe-code/image-ast/portable";
import { yieldTurn } from "safe-bash-contracts/yield";
import { formatSignificantMetric } from "./compare-kernel.js";

type Read = { position: number; length: number };

export function* identifyStatisticsSteps(image: Pick<RgbaImage, "width" | "height" | "space" | "hasAlpha" | "depth">, precision = 6): Generator<Read | undefined, string, Uint8Array | Uint16Array | undefined> {
    const names = image.space === "b-w" ? ["Gray"] : ["Red", "Green", "Blue"];
    const channels = image.space === "b-w" ? [0] : [0, 1, 2];
    if (image.hasAlpha) { names.push("Alpha"); channels.push(3); }
    const range = image.depth === "ushort" ? 65535 : 255;
    const histograms = channels.map(() => new Float64Array(range + 1));
    const count = image.width * image.height;
    for (let position = 0; position < count * 4; position += 4096) {
        yield;
        const length = Math.min(4096, count * 4 - position), samples = yield { position, length };
        if (!samples || samples.length !== length) throw new Error("Truncated statistics pixels");
        for (let i = 0; i < length; i += 4) for (let c = 0; c < channels.length; c++) histograms[c]![samples[i + channels[c]!]!]!++;
    }
    const results = [];
    for (const histogram of histograms) {
        let min = range, max = 0, mean = 0, median = 0, cumulative = 0, distinct = 0, entropy = 0;
        for (let value = 0; value <= range; value++) {
            if (value % 4096 === 0) yield;
            const frequency = histogram[value]!;
            if (!frequency) continue;
            min = Math.min(min, value); max = value; mean += value * frequency / count;
            if (cumulative < Math.ceil(count / 2)) median = value;
            cumulative += frequency; distinct++;
            const probability = frequency / count;
            entropy -= probability * Math.log2(probability);
        }
        let second = 0, third = 0, fourth = 0;
        for (let value = min; value <= max; value++) {
            if (value % 4096 === 0) yield;
            const delta = value - mean, frequency = histogram[value]!;
            second += frequency * delta ** 2; third += frequency * delta ** 3; fourth += frequency * delta ** 4;
        }
        const deviation = Math.sqrt(second / Math.max(1, count - 1));
        results.push({ min, max, mean, median, deviation, kurtosis: deviation ? fourth / count / deviation ** 4 - 3 : 0, skewness: deviation ? third / count / deviation ** 3 : 0, entropy: distinct > 1 ? entropy / Math.log2(distinct) : 0 });
    }
    if (image.space !== "b-w") {
        const overall = { ...results[0]! };
        for (const key of ["mean", "median", "deviation", "kurtosis", "skewness", "entropy"] as const) overall[key] = results.reduce((sum, result) => sum + result[key], 0) / results.length;
        overall.min = Math.min(...results.map(result => result.min));
        overall.max = Math.max(...results.map(result => result.max));
        results.push(overall);
    }
    const f = (value: number) => formatSignificantMetric(value, precision);
    let text = `  Channel statistics:\n    Pixels: ${count}\n`;
    for (let c = 0; c < results.length; c++) {
        if (c === names.length) text += "  Image statistics:\n";
        const result = results[c]!;
        text += `    ${names[c] ?? "Overall"}:\n`;
        for (const [label, value] of [["min", result.min], ["max", result.max], ["mean", result.mean], ["median", result.median], ["standard deviation", result.deviation]] as const) text += `      ${label}: ${f(image.depth === "bit" ? value / range : value)}${label === "min" ? "  " : " "}(${f(value / range)})\n`;
        for (const key of ["kurtosis", "skewness", "entropy"] as const) text += `      ${key}: ${f(result[key])}\n`;
    }
    return text;
}

export async function identifyStoredStatistics(image: StoredRgbaImage, storage: ImageByteStorage, precision: number, signal: AbortSignal): Promise<string> {
    const steps = identifyStatisticsSteps(image, precision);
    let next = steps.next();
    while (!next.done) {
        signal.throwIfAborted();
        if (!next.value) { await yieldTurn(signal); next = steps.next(); }
        else {
            const { position, length } = next.value, size = image.storedData16 ? 2 : 1;
            const bytes = await storage.read((image.storedData16?.position ?? image.position) + position * size, length * size, { signal });
            next = steps.next(size === 2 ? new Uint16Array(new Uint8Array(bytes).buffer) : bytes);
        }
    }
    return next.value;
}
