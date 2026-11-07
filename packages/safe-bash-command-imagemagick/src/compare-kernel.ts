import type { RgbaColor } from "@poe-code/image-ast/portable";
import { perceptualHashSteps } from "./compare-phash.js";
export interface CompareImage {
    readonly width: number;
    readonly height: number;
    readonly hasAlpha: boolean;
}
export interface CompareOptions {
    readonly metric: string;
    readonly fuzz: number;
    readonly highlightColor: RgbaColor;
    readonly lowlightColor?: RgbaColor;
    readonly composeSrc: boolean;
    readonly compose?: (reference: Uint8Array, overlay: Uint8Array) => Generator<void, Uint8Array, void>;
    readonly diff: boolean;
    readonly subimageSearch?: boolean;
    readonly offset?: { x: number; y: number };
}
export type CompareRequest = {
    readonly kind: "read";
    readonly image: 0 | 1;
    readonly position: number;
    readonly length: number;
} | {
    readonly kind: "write";
    readonly position: number;
    readonly data: Uint8Array;
};
export interface CompareResult {
    readonly width: number;
    readonly height: number;
    readonly metric: string;
    readonly exitCode: number;
    readonly distortion: number;
}
/** Borrow input ranges until the next request; output chunks are owned by the receiver. */
export function* compareImageSteps(imgA: CompareImage, imgB: CompareImage, options: CompareOptions): Generator<CompareRequest | undefined, CompareResult, Uint8Array | undefined> {
    if (options.subimageSearch) return yield* searchSubimageSteps(imgA, imgB, options);
    const { metric, fuzz, highlightColor, lowlightColor = { r: 255, g: 255, b: 255, a: 204 }, composeSrc } = options;
    // ImageMagick adds the squared fuzz of both inputs for channel metrics.
    const channelFuzzSquared = 2 * fuzz * fuzz;
    const width = Math.max(imgA.width, imgB.width);
    const height = Math.max(imgA.height, imgB.height);
    const totalPixels = Math.max(1, width * height);
    let pdcCount = 0;
    let aeMagnitude = 0;
    let sumAbs = 0;
    let sumSq = 0;
    let fuzzSq = 0;
    let fuzzChannels = 0;
    let maxAbs = 0;
    let meppSum = 0;
    let meppPeak = 0;
    const hasAlpha = imgA.hasAlpha || imgB.hasAlpha;
    const correlationChannels = (metric === "ncc" || metric === "dpc") ? Array.from({ length: imgA.hasAlpha && imgB.hasAlpha ? 4 : 3 }, () => ({
        rawA: 0, rawB: 0, sumA: 0, sumB: 0, squareA: 0, squareB: 0, product: 0
    })) : [];
    for (let y = 0; y < height; y++) {
        if ((y & 511) === 511)
            yield;
        for (let left = 0; left < width; left += 1024) {
            yield;
            const count = Math.min(1024, width - left);
            // ImageMagick extends the nearest edge across the larger canvas.
            const leftA = Math.min(left, imgA.width - 1);
            const leftB = Math.min(left, imgB.width - 1);
            const lengthA = Math.min(count, imgA.width - leftA) * 4;
            const lengthB = Math.min(count, imgB.width - leftB) * 4;
            let dataA = yield { kind: "read", image: 0, position: (Math.min(y, imgA.height - 1) * imgA.width + leftA) * 4, length: lengthA };
            if (!(dataA instanceof Uint8Array) || dataA.length !== lengthA)
                throw new Error("Truncated comparison pixels");
            dataA = dataA.slice();
            let dataB: Uint8Array | undefined;
            if (options.offset) {
                dataB = dataA.slice();
                const row = y - options.offset.y;
                const start = Math.max(left, options.offset.x);
                const end = Math.min(left + count, options.offset.x + imgB.width);
                if (row >= 0 && row < imgB.height && start < end) {
                    const bytes = yield { kind: "read", image: 1, position: (row * imgB.width + start - options.offset.x) * 4, length: (end - start) * 4 };
                    if (!(bytes instanceof Uint8Array) || bytes.length !== (end - start) * 4)
                        throw new Error("Truncated comparison pixels");
                    dataB.set(bytes, (start - left) * 4);
                }
            } else {
                dataB = yield { kind: "read", image: 1, position: (Math.min(y, imgB.height - 1) * imgB.width + leftB) * 4, length: lengthB };
                if (!(dataB instanceof Uint8Array) || dataB.length !== lengthB)
                    throw new Error("Truncated comparison pixels");
            }
            const diffData = options.diff ? new Uint8Array(count * 4) : undefined;
            const reference = diffData && options.compose ? new Uint8Array(count * 4) : undefined;
            for (let x = left; x < left + count; x++) {
                const outOff = (x - left) * 4;
                const offA = (Math.min(x, imgA.width - 1) - leftA) * 4;
                const offB = options.offset ? outOff : (Math.min(x, imgB.width - 1) - leftB) * 4;
                const rA = dataA[offA]!;
                const gA = dataA[offA + 1]!;
                const bA = dataA[offA + 2]!;
                const aA = dataA[offA + 3]!;
                const rB = dataB[offB]!;
                const gB = dataB[offB + 1]!;
                const bB = dataB[offB + 2]!;
                const aB = dataB[offB + 3]!;
                // NCC and DPC center each channel on its unassociated mean, then
                // combine covariance and variance across all active channels.
                for (let channel = 0; channel < correlationChannels.length; channel++) {
                    const stats = correlationChannels[channel]!;
                    const rawA = dataA[offA + channel]!;
                    const rawB = dataB[offB + channel]!;
                    const a = channel === 3 ? rawA : rawA * aA / 255;
                    const b = channel === 3 ? rawB : rawB * aB / 255;
                    stats.rawA += rawA;
                    stats.rawB += rawB;
                    stats.sumA += a;
                    stats.sumB += b;
                    stats.squareA += a * a;
                    stats.squareB += b * b;
                    stats.product += a * b;
                }
                const dr = Math.abs(rA - rB);
                const dg = Math.abs(gA - gB);
                const db = Math.abs(bA - bB);
                const da = Math.abs(aA - aB);
                const alphaA = aA / 255;
                const alphaB = aB / 255;
                const pdr = Math.abs(rA * alphaA - rB * alphaB);
                const pdg = Math.abs(gA * alphaA - gB * alphaB);
                const pdb = Math.abs(bA * alphaA - bB * alphaB);
                if (metric === "fuzz") {
                    // Fuzz averages squared error over only channels above tolerance.
                    // Alpha participates only when both images have an alpha channel.
                    for (let channel = 0; channel < (imgA.hasAlpha && imgB.hasAlpha ? 4 : 3); channel++) {
                        const delta = channel === 0 ? pdr : channel === 1 ? pdg : channel === 2 ? pdb : da;
                        if (delta * delta > channelFuzzSquared) {
                            fuzzSq += delta * delta;
                            fuzzChannels++;
                        }
                    }
                }
                if (metric === "mepp") {
                    // MEPP ignores fuzz and includes alpha only when both inputs have it.
                    const alphaError = imgA.hasAlpha && imgB.hasAlpha ? da : 0;
                    meppSum += pdr + pdg + pdb + alphaError;
                    meppPeak = Math.max(meppPeak, pdr, pdg, pdb, alphaError);
                }
                // PDC counts a pixel once when any shared channel exceeds fuzz.
                if (metric === "pdc" && Math.max(pdr * pdr, pdg * pdg, pdb * pdb, imgA.hasAlpha && imgB.hasAlpha ? da * da : 0) > channelFuzzSquared)
                    pdcCount++;
                // AE sums channel magnitudes above fuzz, then averages over channels.
                const aeR = hasAlpha ? pdr : dr, aeG = hasAlpha ? pdg : dg, aeB = hasAlpha ? pdb : db;
                aeMagnitude += (aeR * aeR > channelFuzzSquared ? aeR : 0) + (aeG * aeG > channelFuzzSquared ? aeG : 0) + (aeB * aeB > channelFuzzSquared ? aeB : 0) + (hasAlpha && da * da > channelFuzzSquared ? da : 0);
                const maxDelta = hasAlpha ? Math.max(pdr, pdg, pdb, da) : Math.max(dr, dg, db);
                if (diffData) {
                    const color = maxDelta > fuzz ? highlightColor : lowlightColor;
                    // ImageMagick makes the reference opaque before compositing
                    // the highlight/lowlight overlay (80% opaque by default).
                    if (reference) {
                        reference.set([rA, gA, bA, 255], outOff);
                    }
                    const alpha = composeSrc || options.compose ? 1 : color.a / 255;
                    diffData[outOff] = Math.round(color.r * alpha + rA * (1 - alpha));
                    diffData[outOff + 1] = Math.round(color.g * alpha + gA * (1 - alpha));
                    diffData[outOff + 2] = Math.round(color.b * alpha + bA * (1 - alpha));
                    diffData[outOff + 3] = composeSrc || options.compose ? color.a : 255;
                }
                if (hasAlpha) {
                    sumAbs += pdr + pdg + pdb + da;
                    sumSq += pdr * pdr + pdg * pdg + pdb * pdb + da * da;
                }
                else {
                    sumAbs += dr + dg + db;
                    sumSq += dr * dr + dg * dg + db * db;
                }
                if (maxDelta > maxAbs)
                    maxAbs = maxDelta;
            }
            if (diffData) {
                let output: Uint8Array = diffData;
                if (reference) {
                    const composition = options.compose!(reference, diffData);
                    let step = composition.next();
                    try {
                        while (!step.done) { yield; step = composition.next(); }
                        output = step.value;
                    } finally { composition.return(undefined as never); }
                }
                yield { kind: "write", position: (y * width + left) * 4, data: output };
            }
        }
    }
    const numCh = hasAlpha ? 4 : 3;
    const maeNorm = sumAbs / (totalPixels * numCh * 255);
    const mseNorm = sumSq / (totalPixels * numCh * 255 * 255);
    const rmseNorm = Math.sqrt(mseNorm);
    const paeNorm = maxAbs / 255;
    let metricStr: string;
    let distortion = rmseNorm;
    let exitCode = rmseNorm > 1e-6 ? 1 : 0;
    switch (metric) {
        case "phash": {
            const a = yield* perceptualHashSteps(imgA, 0);
            const b = yield* perceptualHashSteps(imgB, 1);
            const channels = imgA.hasAlpha && imgB.hasAlpha ? 4 : 3;
            distortion = 0;
            for (let i = 0; i < Math.min(a.length, b.length); i++) distortion += (a[i]! - b[i]!) ** 2;
            distortion /= channels;
            metricStr = `${formatSignificantMetric(distortion)} (${formatSignificantMetric(distortion)})`;
            exitCode = distortion > 1e-6 ? 1 : 0;
            break;
        }
        case "pdc":
            distortion = pdcCount / totalPixels;
            metricStr = `${formatSignificantMetric(pdcCount)} (${formatSignificantMetric(distortion)})`;
            exitCode = pdcCount > 0 ? 1 : 0;
            break;
        case "ae":
            distortion = aeMagnitude / (totalPixels * numCh * 255);
            metricStr = `${formatSignificantMetric(aeMagnitude / (numCh * 255))} (${formatSignificantMetric(aeMagnitude / (totalPixels * numCh * 255))})`;
            exitCode = distortion > 1e-6 ? 1 : 0;
            break;
        case "fuzz":
            distortion = fuzzChannels === 0 ? 0 : fuzzSq / (fuzzChannels * 255 * 255);
            metricStr = `${formatSignificantMetric(distortion * 65535)} (${formatSignificantMetric(distortion)})`;
            exitCode = distortion > 1e-6 ? 1 : 0;
            break;
        case "mepp":
            distortion = meppSum / (totalPixels * (imgA.hasAlpha && imgB.hasAlpha ? 4 : 3) * 255);
            metricStr = `${formatSignificantMetric(distortion * 65535)} (${formatSignificantMetric(distortion)}, ${formatSignificantMetric(meppPeak / 255)})`;
            exitCode = distortion > 1e-6 ? 1 : 0;
            break;
        case "mae":
            distortion = maeNorm;
            metricStr = `${formatSignificantMetric(maeNorm * 65535)} (${formatSignificantMetric(maeNorm)})`;
            exitCode = distortion > 1e-6 ? 1 : 0;
            break;
        case "mse":
            distortion = mseNorm;
            metricStr = `${formatSignificantMetric(mseNorm * 65535)} (${formatSignificantMetric(mseNorm)})`;
            exitCode = distortion > 1e-6 ? 1 : 0;
            break;
        case "pae":
            distortion = paeNorm;
            exitCode = distortion > 1e-6 ? 1 : 0;
            metricStr = `${formatSignificantMetric(paeNorm * 65535)} (${formatSignificantMetric(paeNorm)})`;
            break;
        case "psnr": {
            const psnr = mseNorm === 0 ? 120 : 10 * Math.log10(1 / mseNorm);
            distortion = psnr / 120;
            exitCode = distortion > 1e-6 ? 1 : 0;
            metricStr = `${formatSignificantMetric(psnr)} (${formatSignificantMetric(psnr / 120)})`;
            break;
        }
        case "phase":
            distortion = yield* comparePhaseSteps(imgA, imgB);
            metricStr = `${formatSignificantMetric(distortion * 65535)} (${formatSignificantMetric(distortion)})`;
            exitCode = Math.abs(distortion) > 1e-6 ? 1 : 0;
            break;
        case "dssim":
        case "ssim": {
            distortion = yield* compareSsimSteps(imgA, imgB);
            metricStr = `${formatSignificantMetric(distortion * 65535)} (${formatSignificantMetric(distortion)})`;
            exitCode = Math.abs(distortion) > 1e-6 ? 1 : 0;
            break;
        }
        case "dpc":
        case "ncc": {
            let varianceA = 0, varianceB = 0, covariance = 0;
            for (const stats of correlationChannels) {
                const meanA = stats.rawA / (imgA.width * imgA.height);
                const meanB = stats.rawB / (imgB.width * imgB.height);
                varianceA += Math.max(0, stats.squareA - 2 * meanA * stats.sumA + totalPixels * meanA * meanA);
                varianceB += Math.max(0, stats.squareB - 2 * meanB * stats.sumB + totalPixels * meanB * meanB);
                covariance += stats.product - meanA * stats.sumB - meanB * stats.sumA + totalPixels * meanA * meanB;
            }
            const denominator = Math.sqrt(varianceA) * Math.sqrt(varianceB);
            const similarity = denominator === 0 ? 0 : covariance / denominator;
            distortion = Math.abs(1 - similarity) < 2e-12 ? 0 : (1 - similarity) / 2;
            metricStr = `${formatSignificantMetric(distortion * 65535)} (${formatSignificantMetric(distortion)})`;
            exitCode = Math.abs(distortion) > 1e-6 ? 1 : 0;
            break;
        }
        case "rmse":
        default:
            metricStr = `${formatSignificantMetric(rmseNorm * 65535)} (${formatSignificantMetric(rmseNorm)})`;
            break;
    }
    return { width, height, metric: metricStr, exitCode, distortion };
}
// Reuse the metric kernel on a virtual crop; translate bounded reads back to
// the reference image so filesystem-backed searches never materialize a crop.
function* searchSubimageSteps(imgA: CompareImage, imgB: CompareImage, options: CompareOptions): Generator<CompareRequest | undefined, CompareResult, Uint8Array | undefined> {
    let best: CompareResult | undefined;
    let offset = { x: 0, y: 0 };
    search: for (let y = 0; y <= imgA.height - imgB.height; y++) {
        for (let x = 0; x <= imgA.width - imgB.width; x++) {
            yield;
            const comparison = compareImageSteps({ ...imgA, width: imgB.width, height: imgB.height }, imgB, { ...options, subimageSearch: false, diff: false });
            let next = comparison.next();
            try {
                while (!next.done) {
                    const request = next.value;
                    if (request?.kind === "read" && request.image === 0) {
                        const pixel = request.position / 4;
                        next = comparison.next(yield { ...request, position: ((y + Math.floor(pixel / imgB.width)) * imgA.width + x + pixel % imgB.width) * 4 });
                    } else next = comparison.next(yield request);
                }
            } finally { comparison.return(undefined as never); }
            const result = next.value;
            if (!best || (options.metric === "psnr" ? result.distortion > best.distortion : result.distortion < best.distortion)) {
                best = result;
                offset = { x, y };
                if (options.metric === "psnr" ? result.distortion === 1 : result.distortion === 0) break search;
            }
        }
    }
    if (!best) throw new Error("geometry does not contain image");
    if (options.diff) yield* compareImageSteps(imgA, imgB, { ...options, subimageSearch: false, offset });
    if (options.metric === "pdc") {
        const count = best.distortion * imgB.width * imgB.height;
        return { ...best, width: imgA.width, height: imgA.height, distortion: count,
            metric: `${formatSignificantMetric(count)} (${formatSignificantMetric(count / (imgA.width * imgA.height))}) @ ${offset.x},${offset.y} [${formatSignificantMetric(count)}]` };
    }
    const normalized = formatSignificantMetric(best.distortion);
    const similarity = options.metric === "ssim" || options.metric === "ncc" || options.metric === "dpc" || options.metric === "phase" ? 1 - 2 * best.distortion : best.distortion;
    const metric = options.metric === "ae"
        ? `${formatSignificantMetric(best.distortion * imgA.width * imgA.height)} (${normalized})`
        : `${formatSignificantMetric(best.distortion * (options.metric === "psnr" ? 120 : options.metric === "phash" ? 1 : 65535))} (${normalized})`;
    return { ...best, width: imgA.width, height: imgA.height, metric: `${metric} @ ${offset.x},${offset.y} [${formatSignificantMetric(similarity)}]` };
}
export function formatMetricNum(n: number): string {
    if (!Number.isFinite(n))
        return "inf";
    if (Math.abs(n) < 1e-9)
        return "0";
    const fixed = n.toFixed(6).replace(/\.?0+$/, "");
    return fixed === "-0" ? "0" : fixed;
}

function formatSignificantMetric(n: number): string {
    const rounded = Number(n.toPrecision(6));
    if (rounded === 0 || (rounded >= 0.0001 && rounded < 1000000))
        return String(rounded);
    const [mantissa, exponent] = rounded.toExponential().split("e");
    return `${mantissa}e${exponent![0]}${exponent!.slice(1).padStart(2, "0")}`;
}

// ImageMagick uses an 11x11 Gaussian window (sigma 1.5), edge virtual
// pixels, and independent channel statistics before averaging the similarity.
function* compareSsimSteps(imgA: CompareImage, imgB: CompareImage): Generator<CompareRequest | undefined, number, Uint8Array | undefined> {
    const width = Math.max(imgA.width, imgB.width), height = Math.max(imgA.height, imgB.height);
    const channels = imgA.hasAlpha && imgB.hasAlpha ? 4 : 3;
    const weights = Array.from({ length: 11 }, (_, i) => Math.exp(-((i - 5) ** 2) / (2 * 1.5 ** 2)));
    const weightSum = weights.reduce((sum, value) => sum + value, 0);
    for (let i = 0; i < weights.length; i++)
        weights[i] = weights[i]! / weightSum;
    let similarity = 0;
    for (let y = 0; y < height; y++) {
        // Include the halo in the 1024-pixel read limit. Copy borrowed reads
        // because all eleven rows must remain available across requests.
        for (let left = 0; left < width; left += 1014) {
            yield;
            const count = Math.min(1014, width - left);
            const rows: Uint8Array[][] = [[], []];
            const starts: number[] = [];
            for (const image of [0, 1] as const) {
                const info = image === 0 ? imgA : imgB;
                const start = Math.min(info.width - 1, Math.max(0, left - 5));
                const end = Math.min(info.width, left + count + 5);
                starts[image] = start;
                for (let v = -5; v <= 5; v++) {
                    const row = Math.max(0, Math.min(info.height - 1, y + v));
                    const length = (end - start) * 4;
                    const data = yield { kind: "read", image, position: (row * info.width + start) * 4, length };
                    if (!(data instanceof Uint8Array) || data.length !== length)
                        throw new Error("Truncated comparison pixels");
                    rows[image]!.push(data.slice());
                }
            }
            for (let x = left; x < left + count; x++) {
                for (let channel = 0; channel < channels; channel++) {
                    let muA = 0, muB = 0, squareA = 0, squareB = 0, product = 0;
                    for (let v = 0; v < 11; v++) {
                        for (let u = 0; u < 11; u++) {
                            const offsetA = (Math.max(0, Math.min(imgA.width - 1, x + u - 5)) - starts[0]!) * 4 + channel;
                            const offsetB = (Math.max(0, Math.min(imgB.width - 1, x + u - 5)) - starts[1]!) * 4 + channel;
                            const a = rows[0]![v]![offsetA]! / 255, b = rows[1]![v]![offsetB]! / 255;
                            const weight = weights[u]! * weights[v]!;
                            muA += weight * a;
                            muB += weight * b;
                            squareA += weight * a * a;
                            squareB += weight * b * b;
                            product += weight * a * b;
                        }
                    }
                    similarity += ((2 * muA * muB + 0.0001) * (2 * (product - muA * muB) + 0.0009)) /
                        ((muA * muA + muB * muB + 0.0001) * (squareA - muA * muA + squareB - muB * muB + 0.0009));
                }
            }
        }
    }
    const distortion = (1 - similarity / (width * height * channels)) / 2;
    return Math.abs(distortion) < 1e-12 ? 0 : distortion;
}

// PHASE correlates LoG:0,1 edge surfaces per channel. Keep signed HDRI
// values: rounding or clamping the convolution changes the metric.
function* comparePhaseSteps(imgA: CompareImage, imgB: CompareImage): Generator<CompareRequest | undefined, number, Uint8Array | undefined> {
    const width = Math.max(imgA.width, imgB.width), height = Math.max(imgA.height, imgB.height);
    const channels = imgA.hasAlpha && imgB.hasAlpha ? 4 : 3;
    const kernel = Array.from({ length: 81 }, (_, i) => {
        const radius = ((i % 9 - 4) ** 2 + (Math.floor(i / 9) - 4) ** 2) / 2;
        return (1 - radius) * Math.exp(-radius) / Math.PI;
    });
    const positive = kernel.reduce((sum, weight) => sum + Math.max(0, weight), 0);
    const negative = kernel.reduce((sum, weight) => sum - Math.min(0, weight), 0);
    for (let i = 0; i < kernel.length; i++) kernel[i]! /= kernel[i]! >= 0 ? positive : negative;
    const stats = Array.from({ length: channels }, () => ({ a: 0, b: 0, aa: 0, bb: 0, ab: 0 }));
    for (let y = 0; y < height; y++) for (let left = 0; left < width; left += 1016) {
        yield;
        const count = Math.min(1016, width - left);
        const surfaces: Float64Array[] = [];
        for (const image of [0, 1] as const) {
            const info = image === 0 ? imgA : imgB;
            const surface = new Float64Array(count * channels);
            const gamma = new Float64Array(count);
            const start = Math.max(0, Math.min(info.width - 1, left - 4));
            const end = Math.min(info.width, left + count + 4);
            for (let v = -4; v <= 4; v++) {
                const row = Math.max(0, Math.min(info.height - 1, Math.min(y, info.height - 1) + v));
                const length = (end - start) * 4;
                const bytes = yield { kind: "read", image, position: (row * info.width + start) * 4, length };
                if (!(bytes instanceof Uint8Array) || bytes.length !== length) throw new Error("Truncated comparison pixels");
                for (let x = 0; x < count; x++) for (let u = -4; u <= 4; u++) {
                    const column = Math.max(0, Math.min(info.width - 1, Math.min(left + x, info.width - 1) + u));
                    const offset = (column - start) * 4;
                    const weight = kernel[(v + 4) * 9 + u + 4]!;
                    const alpha = info.hasAlpha ? bytes[offset + 3]! / 255 : 1;
                    gamma[x]! += weight * alpha;
                    for (let channel = 0; channel < channels; channel++)
                        surface[x * channels + channel]! += weight * bytes[offset + channel]! / 255 * (channel === 3 ? 1 : alpha);
                }
            }
            if (info.hasAlpha) for (let x = 0; x < count; x++) {
                const divisor = gamma[x]!;
                const reciprocal = (divisor < 0 ? -1 : 1) / Math.max(Math.abs(divisor), 1e-12);
                for (let channel = 0; channel < 3; channel++) surface[x * channels + channel]! *= reciprocal;
            }
            // Q16-HDRI stores each convolved sample as a float Quantum.
            for (let i = 0; i < surface.length; i++) surface[i] = Math.fround(surface[i]! * 65535) / 65535;
            surfaces.push(surface);
        }
        for (let x = 0; x < count; x++) for (let channel = 0; channel < channels; channel++) {
            const a = surfaces[0]![x * channels + channel]!, b = surfaces[1]![x * channels + channel]!;
            const stat = stats[channel]!;
            stat.a += a; stat.b += b; stat.aa += a * a; stat.bb += b * b; stat.ab += a * b;
        }
    }
    const area = width * height;
    let similarity = 0;
    for (const stat of stats) {
        const varianceA = area * stat.aa - stat.a * stat.a;
        const varianceB = area * stat.bb - stat.b * stat.b;
        let pearson: number;
        if (varianceA < 1e-12 && varianceB < 1e-12) pearson = Math.abs(stat.a - stat.b) < 1e-12 ? 1 : 0;
        else {
            const denominator = Math.sqrt(Math.max(0, varianceA)) * Math.sqrt(Math.max(0, varianceB));
            pearson = denominator < 1e-12 ? 0 : (area * stat.ab - stat.a * stat.b) / denominator;
        }
        similarity += Math.max(-1, Math.min(1, pearson));
    }
    const distortion = (1 - similarity / channels) / 2;
    return Math.abs(distortion) < 1e-12 ? 0 : distortion;
}
