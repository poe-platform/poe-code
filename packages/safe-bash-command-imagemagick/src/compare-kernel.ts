import { compareDiffSteps } from "./compare-colorspace.js";
import type { RgbaColor } from "@poe-code/image-ast/portable";
import { perceptualHashSteps } from "./compare-phash.js";
// Samples retain the kernel's 0..255 scale without rounding high-depth input.
export type CompareSamples = Uint8Array | Float64Array;
export interface CompareImage {
    readonly width: number;
    readonly height: number;
    readonly hasAlpha: boolean;
    readonly readMask?: { readonly width: number; readonly height: number } | undefined;
    readonly space?: string;
    readonly magickColorspace?: string | undefined;
}
export interface CompareOptions {
    readonly phashColorspaces?: readonly string[];
    readonly phashNormalize?: boolean;
    readonly precision?: number;
    readonly ssimRadius?: number;
    readonly ssimSigma?: number;
    readonly channels?: readonly number[];
    readonly metric: string;
    readonly fuzz: number;
    readonly highlightColor: RgbaColor;
    readonly lowlightColor?: RgbaColor;
    readonly composeSrc: boolean;
    readonly compose?: (reference: Uint8Array, overlay: Uint8Array) => Generator<void, Uint8Array, void>;
    readonly diff: boolean;
    readonly highDepthDiff?: boolean;
    readonly subimageSearch?: boolean;
    readonly similarityThreshold?: number;
    readonly offset?: { x: number; y: number };
}
export type CompareRequest = {
    readonly kind: "read";
    readonly mask?: boolean;
    readonly image: 0 | 1;
    readonly position: number;
    readonly length: number;
} | {
    readonly kind: "write" | "similarity";
    readonly position: number;
    readonly data: Uint8Array;
    readonly data16?: Uint16Array;
};
export interface CompareResult {
    readonly width: number;
    readonly height: number;
    readonly metric: string;
    readonly exitCode: number;
    readonly distortion: number;
    readonly constantColor: boolean;
}
function* readCompareMaskSteps(info: CompareImage, image: 0 | 1, left: number, y: number, count: number): Generator<CompareRequest | undefined, Uint8Array | undefined, CompareSamples | undefined> {
    const mask = info.readMask;
    if (!mask) return;
    const x = Math.max(0, Math.min(left, info.width - 1, mask.width - 1));
    const row = Math.max(0, Math.min(y, info.height - 1, mask.height - 1));
    const length = Math.min(count, mask.width - x, info.width - x) * 4;
    const samples = yield { kind: "read", image, mask: true, position: (row * mask.width + x) * 4, length };
    if (!samples || samples.length !== length) throw new Error("Truncated comparison mask");
    const selected = new Uint8Array(count);
    for (let i = 0; i < count; i++) {
        const offset = Math.max(0, Math.min(Math.max(0, left + i) - x, length / 4 - 1)) * 4;
        selected[i] = Number(0.212656 * samples[offset]! + 0.715158 * samples[offset + 1]! + 0.072186 * samples[offset + 2]! > 127.5);
    }
    return selected;
}

/** Borrow input ranges until the next request; output chunks are owned by the receiver. */
export function* compareImageSteps(imgA: CompareImage, imgB: CompareImage, options: CompareOptions): Generator<CompareRequest | undefined, CompareResult, CompareSamples | undefined> {
    if (options.subimageSearch) return yield* searchSubimageSteps(imgA, imgB, options);
    const { metric, fuzz, highlightColor, lowlightColor = { r: 255, g: 255, b: 255, a: 204 }, composeSrc } = options;
    // ImageMagick adds the squared fuzz of both inputs for channel metrics.
    const channelFuzzSquared = 2 * fuzz * fuzz;
    const width = Math.max(imgA.width, imgB.width);
    const height = Math.max(imgA.height, imgB.height);
    const totalPixels = Math.max(1, width * height);
    let selectedPixels = 0;
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
    const grayscale = imgA.space === "b-w" || imgA.space === "grey16";
    const strideA = imgA.space === "cmyk" ? 5 : 4, strideB = imgB.space === "cmyk" ? 5 : 4;
    const cmyk = strideA === 5 && strideB === 5;
    const selected = (options.channels ?? [0, 1, 2, 3, 4]).filter(channel => channel !== 4 || cmyk);
    const red = selected.includes(0), green = selected.includes(1), blue = selected.includes(2), opacity = selected.includes(3);
    const sharedChannels = selected.filter(channel => channel !== 3 || (imgA.hasAlpha && imgB.hasAlpha));
    const numCh = Math.max(1, sharedChannels.length);
    const correlationChannels = (metric === "ncc" || metric === "dpc") ? sharedChannels.map(channel => ({ channel,
        rawA: 0, rawB: 0, sumA: 0, sumB: 0, squareA: 0, squareB: 0, product: 0
    })) : [];
    // Native GetImageRange pools the candidate's selected channels, without
    // alpha association or read-mask filtering. Reuse the bounded pixel reads.
    const rangeChannels = ["ncc", "dpc", "phase"].includes(metric)
        ? (options.channels ?? [0, 1, 2, 3, 4]).filter(channel => channel === 3 ? imgB.hasAlpha : channel !== 4 || strideB === 5)
        : [];
    let minimum = Infinity, maximum = -Infinity;
    for (let y = 0; y < height; y++) {
        if ((y & 511) === 511)
            yield;
        for (let left = 0; left < width; left += 1024) {
            yield;
            const count = Math.min(1024, width - left);
            const maskA = yield* readCompareMaskSteps(imgA, 0, left, y, count);
            const maskB = yield* readCompareMaskSteps(imgB, 1, left - (options.offset?.x ?? 0), y - (options.offset?.y ?? 0), count);
            // ImageMagick extends the nearest edge across the larger canvas.
            const leftA = Math.min(left, imgA.width - 1);
            const leftB = Math.min(left, imgB.width - 1);
            const lengthA = Math.min(count, imgA.width - leftA) * 4;
            const lengthB = Math.min(count, imgB.width - leftB) * 4;
            let dataA = yield { kind: "read", image: 0, position: (Math.min(y, imgA.height - 1) * imgA.width + leftA) * 4, length: lengthA };
            if (!dataA || dataA.length !== lengthA / 4 * strideA)
                throw new Error("Truncated comparison pixels");
            dataA = dataA.slice();
            let dataB: CompareSamples | undefined;
            if (options.offset) {
                dataB = Float64Array.from(dataA);
                const row = y - options.offset.y;
                const start = Math.max(left, options.offset.x);
                const end = Math.min(left + count, options.offset.x + imgB.width);
                if (row >= 0 && row < imgB.height && start < end) {
                    const bytes = yield { kind: "read", image: 1, position: (row * imgB.width + start - options.offset.x) * 4, length: (end - start) * 4 };
                    if (!bytes || bytes.length !== (end - start) * strideB)
                        throw new Error("Truncated comparison pixels");
                    dataB.set(bytes, (start - left) * strideB);
                }
            } else {
                dataB = yield { kind: "read", image: 1, position: (Math.min(y, imgB.height - 1) * imgB.width + leftB) * 4, length: lengthB };
                if (!dataB || dataB.length !== lengthB / 4 * strideB)
                    throw new Error("Truncated comparison pixels");
            }
            const diffData = options.diff ? new Float64Array(count * strideA) : undefined;
            const reference = diffData && options.compose ? new Uint8Array(count * 4) : undefined;
            for (let x = left; x < left + count; x++) {
                const outOff = (x - left) * strideA;
                const offA = (Math.min(x, imgA.width - 1) - leftA) * strideA;
                const offB = options.offset ? outOff : (Math.min(x, imgB.width - 1) - leftB) * strideB;
                const rA = dataA[offA]!;
                const gA = dataA[offA + 1]!;
                const bA = dataA[offA + 2]!;
                const aA = dataA[offA + 3]!;
                const rB = dataB[offB]!;
                const gB = dataB[offB + 1]!;
                const bB = dataB[offB + 2]!;
                const aB = dataB[offB + 3]!;
                const dr = red ? Math.abs(rA - rB) : 0;
                const dg = green ? Math.abs(gA - gB) : 0;
                const db = blue ? Math.abs(bA - bB) : 0;
                const da = opacity ? Math.abs(aA - aB) : 0;
                const alphaA = aA / 255;
                const alphaB = aB / 255;
                const pdr = red ? Math.abs(rA * alphaA - rB * alphaB) : 0;
                const pdg = green ? Math.abs(gA * alphaA - gB * alphaB) : 0;
                const pdb = blue ? Math.abs(bA * alphaA - bB * alphaB) : 0;
                const dk = cmyk && selected.includes(4) ? Math.abs(dataA[offA + 4]! * alphaA - dataB[offB + 4]! * alphaB) : 0;
                const included = (maskA?.[x - left] ?? 1) !== 0 && (maskB?.[x - left] ?? 1) !== 0;
                const maxDelta = hasAlpha ? Math.max(pdr, pdg, pdb, da, dk) : Math.max(dr, dg, db, dk);
                if (diffData) {
                    const color = included ? (maxDelta > fuzz ? highlightColor : lowlightColor) : { r: 136, g: 136, b: 136, a: 204 };
                    // ImageMagick makes the reference opaque before compositing
                    // the highlight/lowlight overlay (80% opaque by default).
                    if (reference) {
                        reference.set([rA, gA, bA, 255], (x - left) * 4);
                    }
                    const alpha = composeSrc || options.compose ? 1 : color.a / 255;
                    diffData[outOff] = red ? color.r * alpha + rA * (1 - alpha) : strideA === 5 ? 0 : color.r;
                    diffData[outOff + 1] = green ? color.g * alpha + gA * (1 - alpha) : strideA === 5 ? 0 : color.g;
                    diffData[outOff + 2] = blue ? color.b * alpha + bA * (1 - alpha) : strideA === 5 ? 0 : color.b;
                    diffData[outOff + 3] = composeSrc || options.compose ? color.a : 255;
                    if (strideA === 5) diffData[outOff + 4] = selected.includes(4) ? dataA[offA + 4]! * (1 - alpha) : 0;
                }
                for (const channel of rangeChannels) {
                    const sample = dataB[offB + channel]!;
                    minimum = Math.min(minimum, sample);
                    maximum = Math.max(maximum, sample);
                }
                if (!included) continue;
                selectedPixels++;
                // NCC and DPC center each channel on its unassociated mean, then
                // combine covariance and variance across all active channels.
                for (const stats of correlationChannels) {
                    const rawA = dataA[offA + stats.channel]!;
                    const rawB = dataB[offB + stats.channel]!;
                    const a = stats.channel === 3 ? rawA : rawA * aA / 255;
                    const b = stats.channel === 3 ? rawB : rawB * aB / 255;
                    stats.rawA += rawA;
                    stats.rawB += rawB;
                    stats.sumA += a;
                    stats.sumB += b;
                    stats.squareA += a * a;
                    stats.squareB += b * b;
                    stats.product += a * b;
                }

                if (metric === "fuzz") {
                    // Fuzz averages squared error over only channels above tolerance.
                    // Alpha participates only when both images have an alpha channel.
                    for (const channel of sharedChannels) {
                        const delta = channel === 0 ? pdr : channel === 1 ? pdg : channel === 2 ? pdb : channel === 4 ? dk : da;
                        if (delta * delta > channelFuzzSquared) {
                            fuzzSq += delta * delta;
                            fuzzChannels++;
                        }
                    }
                }
                if (metric === "mepp") {
                    // MEPP ignores fuzz and includes alpha only when both inputs have it.
                    const alphaError = imgA.hasAlpha && imgB.hasAlpha ? da : 0;
                    meppSum += pdr + pdg + pdb + dk + alphaError;
                    meppPeak = Math.max(meppPeak, pdr, pdg, pdb, dk, alphaError);
                }
                // PDC counts a pixel once when any shared channel exceeds fuzz.
                if (metric === "pdc" && Math.max(pdr * pdr, pdg * pdg, pdb * pdb, dk * dk, imgA.hasAlpha && imgB.hasAlpha ? da * da : 0) > channelFuzzSquared)
                    pdcCount++;
                // AE sums channel magnitudes above fuzz, then averages over channels.
                const aeR = hasAlpha ? pdr : dr, aeG = hasAlpha ? pdg : dg, aeB = hasAlpha ? pdb : db;
                aeMagnitude += (dk * dk > channelFuzzSquared ? dk : 0) + (aeR * aeR > channelFuzzSquared ? aeR : 0) + (aeG * aeG > channelFuzzSquared ? aeG : 0) + (aeB * aeB > channelFuzzSquared ? aeB : 0) + (hasAlpha && da * da > channelFuzzSquared ? da : 0);
                if (hasAlpha) {
                    sumAbs += pdr + pdg + pdb + dk + da;
                    sumSq += pdr * pdr + pdg * pdg + pdb * pdb + dk * dk + da * da;
                }
                else {
                    sumAbs += dr + dg + db + dk;
                    sumSq += dr * dr + dg * dg + db * db + dk * dk;
                }
                if (maxDelta > maxAbs)
                    maxAbs = maxDelta;
            }
            if (diffData) {
                const rendering = compareDiffSteps(diffData, imgA.space, imgA.magickColorspace, options.highDepthDiff && !options.compose);
                let rendered = rendering.next();
                try { while (!rendered.done) { yield; rendered = rendering.next(); } }
                finally { rendering.return(undefined as never); }
                let output = rendered.value.data;
                const data16 = rendered.value.data16;
                if (reference) {
                    const composition = options.compose!(reference, output);
                    let step = composition.next();
                    try {
                        while (!step.done) { yield; step = composition.next(); }
                        output = step.value;
                        for (let i = 0; i < output.length; i++)
                            if (i % 4 < 3 && !selected.includes(i % 4)) output[i] = diffData[i]!;
                    } finally { composition.return(undefined as never); }
                }
                // Native grayscale channel setters share one sample; blue is
                // written last when applying the highlight/lowlight overlay.
                if (grayscale) for (let i = 0; i < output.length; i += 4)
                    output[i] = output[i + 1] = output[i + 2]!;
                if (grayscale && data16) for (let i = 0; i < data16.length; i += 4)
                    data16[i] = data16[i + 1] = data16[i + 2]!;
                yield { kind: "write", position: (y * width + left) * 4, data: output, ...(data16 ? { data16 } : {}) };
            }
        }
    }
    const measuredPixels = Math.max(1, selectedPixels);
    const maeNorm = sumAbs / (measuredPixels * numCh * 255);
    const mseNorm = sumSq / (measuredPixels * numCh * 255 * 255);
    const rmseNorm = Math.sqrt(mseNorm);
    const paeNorm = maxAbs / 255;
    let metricStr: string;
    let distortion = rmseNorm;
    let exitCode = rmseNorm > 1e-6 ? 1 : 0;
    switch (metric) {
        case "phash": {
            const a = yield* perceptualHashSteps(imgA, 0, selected, options.phashColorspaces);
            const b = yield* perceptualHashSteps(imgB, 1, selected, options.phashColorspaces);
            const channels = Math.max(1, sharedChannels.length);
            distortion = 0;
            for (let i = 0; i < Math.min(a.length, b.length); i++)
                if (selected.includes(Math.floor(i / 7) % 3)) distortion += (a[i]! - b[i]!) ** 2;
            distortion /= channels;
            if (options.phashNormalize) distortion = Math.sqrt(distortion / (a.length / 21));
            metricStr = `${formatSignificantMetric(distortion, options.precision)} (${formatSignificantMetric(distortion, options.precision)})`;
            exitCode = distortion > 1e-6 ? 1 : 0;
            break;
        }
        case "pdc":
            distortion = pdcCount / totalPixels;
            metricStr = `${formatSignificantMetric(pdcCount, options.precision)} (${formatSignificantMetric(distortion, options.precision)})`;
            exitCode = pdcCount > 0 ? 1 : 0;
            break;
        case "ae":
            distortion = aeMagnitude / (totalPixels * numCh * 255);
            metricStr = `${formatSignificantMetric(aeMagnitude / (numCh * 255), options.precision)} (${formatSignificantMetric(aeMagnitude / (totalPixels * numCh * 255), options.precision)})`;
            exitCode = distortion > 1e-6 ? 1 : 0;
            break;
        case "fuzz":
            distortion = fuzzChannels === 0 ? 0 : fuzzSq / (fuzzChannels * 255 * 255);
            metricStr = `${formatSignificantMetric(distortion * 65535, options.precision)} (${formatSignificantMetric(distortion, options.precision)})`;
            exitCode = distortion > 1e-6 ? 1 : 0;
            break;
        case "mepp":
            distortion = meppSum / (measuredPixels * Math.max(1, sharedChannels.length) * 255);
            metricStr = `${formatSignificantMetric(distortion * 65535, options.precision)} (${formatSignificantMetric(distortion, options.precision)}, ${formatSignificantMetric(meppPeak / 255, options.precision)})`;
            exitCode = distortion > 1e-6 ? 1 : 0;
            break;
        case "mae":
            distortion = maeNorm;
            metricStr = `${formatSignificantMetric(maeNorm * 65535, options.precision)} (${formatSignificantMetric(maeNorm, options.precision)})`;
            exitCode = distortion > 1e-6 ? 1 : 0;
            break;
        case "mse":
            distortion = mseNorm;
            metricStr = `${formatSignificantMetric(mseNorm * 65535, options.precision)} (${formatSignificantMetric(mseNorm, options.precision)})`;
            exitCode = distortion > 1e-6 ? 1 : 0;
            break;
        case "pae":
            distortion = paeNorm;
            exitCode = distortion > 1e-6 ? 1 : 0;
            metricStr = `${formatSignificantMetric(paeNorm * 65535, options.precision)} (${formatSignificantMetric(paeNorm, options.precision)})`;
            break;
        case "psnr": {
            const psnr = mseNorm === 0 ? 120 : 10 * Math.log10(1 / mseNorm);
            distortion = psnr / 120;
            exitCode = distortion > 1e-6 ? 1 : 0;
            metricStr = `${formatSignificantMetric(psnr, options.precision)} (${formatSignificantMetric(psnr / 120, options.precision)})`;
            break;
        }
        case "phase":
            distortion = yield* comparePhaseSteps(imgA, imgB, sharedChannels);
            metricStr = `${formatSignificantMetric(distortion * 65535, options.precision)} (${formatSignificantMetric(distortion, options.precision)})`;
            exitCode = Math.abs(distortion) > 1e-6 ? 1 : 0;
            break;
        case "dssim":
        case "ssim": {
            distortion = yield* compareSsimSteps(imgA, imgB, sharedChannels, options.ssimRadius, options.ssimSigma);
            metricStr = `${formatSignificantMetric(distortion * 65535, options.precision)} (${formatSignificantMetric(distortion, options.precision)})`;
            exitCode = Math.abs(distortion) > 1e-6 ? 1 : 0;
            break;
        }
        case "dpc":
        case "ncc": {
            let varianceA = 0, varianceB = 0, covariance = 0;
            for (const stats of correlationChannels) {
                const meanA = stats.rawA / (imgA.readMask ? measuredPixels : imgA.width * imgA.height);
                const meanB = stats.rawB / (imgB.readMask ? measuredPixels : imgB.width * imgB.height);
                varianceA += Math.max(0, stats.squareA - 2 * meanA * stats.sumA + measuredPixels * meanA * meanA);
                varianceB += Math.max(0, stats.squareB - 2 * meanB * stats.sumB + measuredPixels * meanB * meanB);
                covariance += stats.product - meanA * stats.sumB - meanB * stats.sumA + measuredPixels * meanA * meanB;
            }
            const denominator = Math.sqrt(varianceA) * Math.sqrt(varianceB);
            const similarity = denominator === 0 ? 0 : covariance / denominator;
            distortion = Math.abs(1 - similarity) < 2e-12 ? 0 : (1 - similarity) / 2;
            metricStr = `${formatSignificantMetric(distortion * 65535, options.precision)} (${formatSignificantMetric(distortion, options.precision)})`;
            exitCode = Math.abs(distortion) > 1e-6 ? 1 : 0;
            break;
        }
        case "rmse":
        default:
            metricStr = `${formatSignificantMetric(rmseNorm * 65535, options.precision)} (${formatSignificantMetric(rmseNorm, options.precision)})`;
            break;
    }
    return { width, height, metric: metricStr, exitCode, distortion, constantColor: Math.abs(maximum - minimum) < 1e-12 / 257 };
}
// Reuse the metric kernel on a virtual crop; translate bounded reads back to
// the reference image so filesystem-backed searches never materialize a crop.
function* searchSubimageSteps(imgA: CompareImage, imgB: CompareImage, options: CompareOptions): Generator<CompareRequest | undefined, CompareResult, CompareSamples | undefined> {
    let best: CompareResult | undefined;
    let offset = { x: 0, y: 0 };
    search: for (let y = 0; y < (options.diff ? imgA.height : imgA.height - imgB.height + 1); y++) {
        for (let x = 0; x < (options.diff ? imgA.width : imgA.width - imgB.width + 1); x++) {
            yield;
            const comparison = compareImageSteps({ ...imgA, width: imgB.width, height: imgB.height, ...(imgA.readMask ? { readMask: { width: imgB.width, height: imgB.height } } : {}) }, imgB, { ...options, subimageSearch: false, diff: false });
            let next = comparison.next();
            try {
                while (!next.done) {
                    const request = next.value;
                    if (request?.kind === "read" && request.image === 0) {
                        const pixel = request.position / 4;
                        const source = request.mask ? imgA.readMask! : imgA;
                        const row = Math.min(y + Math.floor(pixel / imgB.width), source.height - 1);
                        const left = Math.min(x + pixel % imgB.width, source.width - 1);
                        const length = Math.min(request.length, (source.width - left) * 4);
                        const bytes = yield { ...request, position: (row * source.width + left) * 4, length };
                        const stride = !request.mask && imgA.space === "cmyk" ? 5 : 4;
                        if (!bytes || bytes.length !== length / 4 * stride) throw new Error("Truncated comparison pixels");
                        if (length === request.length) next = comparison.next(bytes);
                        else {
                            const extended = bytes instanceof Float64Array ? new Float64Array(request.length / 4 * stride) : new Uint8Array(request.length / 4 * stride);
                            extended.set(bytes);
                            for (let i = bytes.length; i < extended.length; i += stride) extended.set(bytes.subarray(bytes.length - stride), i);
                            next = comparison.next(extended);
                        }
                    } else next = comparison.next(yield request);
                }
            } finally { comparison.return(undefined as never); }
            const result = next.value;
            if (options.diff) {
                const similarity = ["ssim", "ncc", "dpc", "phase"].includes(options.metric) ? 1 - 2 * result.distortion : options.metric === "psnr" ? result.distortion : 1 - result.distortion;
                const value = Math.round(255 * Math.max(0, Math.min(1, similarity)));
                yield { kind: "similarity", position: (y * imgA.width + x) * 4, data: new Uint8Array([value, value, value, 255]) };
            }
            if (x <= imgA.width - imgB.width && y <= imgA.height - imgB.height && (!best || (options.metric === "psnr" ? result.distortion > best.distortion : result.distortion < best.distortion))) {
                best = result;
                offset = { x, y };
                if (!options.diff && (options.metric === "psnr" ? result.distortion === 1 : result.distortion === 0)) break search;
            }
        }
        // Native search finishes the whole row before checking this threshold.
        const threshold = options.similarityThreshold ?? -1;
        if (best && threshold !== -1) {
            const correlation = ["ssim", "ncc", "dpc", "phase"].includes(options.metric);
            const score = correlation ? 1 - 2 * best.distortion : best.distortion;
            if (correlation || options.metric === "psnr" ? score >= threshold : score < threshold) {
                // Unsearched rows in the native similarity map remain opaque black.
                if (options.diff) for (let position = (y + 1) * imgA.width * 4; position < imgA.width * imgA.height * 4;) {
                    const data = new Uint8Array(Math.min(65536, imgA.width * imgA.height * 4 - position));
                    for (let i = 3; i < data.length; i += 4) data[i] = 255;
                    yield { kind: "similarity", position, data };
                    position += data.length;
                }
                break;
            }
        }
    }
    if (!best) throw new Error("geometry does not contain image");
    if (options.diff) yield* compareImageSteps(imgA, imgB, { ...options, subimageSearch: false, offset });
    if (options.metric === "pdc") {
        const count = best.distortion * imgB.width * imgB.height;
        return { ...best, width: imgA.width, height: imgA.height, distortion: count,
            metric: `${formatSignificantMetric(count, options.precision)} (${formatSignificantMetric(count / (imgA.width * imgA.height), options.precision)}) @ ${offset.x},${offset.y} [${formatSignificantMetric(count, options.precision)}]` };
    }
    const normalized = formatSignificantMetric(best.distortion, options.precision);
    const similarity = options.metric === "ssim" || options.metric === "ncc" || options.metric === "dpc" || options.metric === "phase" ? 1 - 2 * best.distortion : best.distortion;
    const metric = options.metric === "ae"
        ? `${formatSignificantMetric(best.distortion * imgA.width * imgA.height, options.precision)} (${normalized})`
        : `${formatSignificantMetric(best.distortion * (options.metric === "psnr" ? 120 : options.metric === "phash" ? 1 : 65535), options.precision)} (${normalized})`;
    return { ...best, width: imgA.width, height: imgA.height, metric: `${metric} @ ${offset.x},${offset.y} [${formatSignificantMetric(similarity, options.precision)}]` };
}
export function formatMetricNum(n: number): string {
    if (!Number.isFinite(n))
        return "inf";
    if (Math.abs(n) < 1e-9)
        return "0";
    const fixed = n.toFixed(6).replace(/\.?0+$/, "");
    return fixed === "-0" ? "0" : fixed;
}

export function formatSignificantMetric(n: number, precision = 6): string {
    if (!Number.isFinite(n)) return "inf";
    if (n === 0) return "0";
    const [mantissa, exponent] = n.toExponential(precision - 1).split("e");
    const power = Number(exponent);
    const places = precision - power - 1, magnitude = Math.abs(n);
    // Powers of two detect exact fractional ties without decimal scaling rounding
    // nearby doubles into ties. Beyond 10^22, integer ties cannot fit in a double.
    const halfway = places >= 0
        ? (magnitude * 2 ** places) % 1 === 0.5
        : places >= -22 && magnitude % 10 ** -places === 10 ** -places / 2;
    const roundTie = (text: string): string => halfway && Number(text.at(-1)) % 2 === 1
        ? text.slice(0, -1) + String(Number(text.at(-1)) - 1) : text;
    if (power < -4 || power >= precision) {
        return `${Number(roundTie(mantissa!))}e${exponent![0]}${exponent!.slice(1).padStart(2, "0")}`;
    }
    const fixed = roundTie(n.toFixed(Math.min(100, Math.max(0, places))));
    return fixed.includes(".") ? fixed.replace(/\.?0+$/, "") : fixed;
}

// ImageMagick defaults to an 11x11 Gaussian window (sigma 1.5), edge virtual
// pixels, and independent channel statistics before averaging the similarity.
function* compareSsimSteps(imgA: CompareImage, imgB: CompareImage, selected: readonly number[], radius = 5, sigma = 1.5): Generator<CompareRequest | undefined, number, CompareSamples | undefined> {
    if (selected.length === 0) return 0;
    const width = Math.max(imgA.width, imgB.width), height = Math.max(imgA.height, imgB.height);
    sigma = Math.abs(sigma);
    let half = radius >= 1 ? Math.floor(radius) : radius > 1e-12 ? Math.ceil(radius) : 1;
    if (!Number.isFinite(radius) || !Number.isFinite(sigma)) throw new Error("Invalid SSIM window");
    if (radius <= 1e-12 && sigma > 1e-12) {
        let sum = 1 + 2 * Math.exp(-1 / (2 * sigma * sigma));
        for (half = 2; half < 512; half++) {
            yield;
            const edge = Math.exp(-half * half / (2 * sigma * sigma));
            sum += 2 * edge;
            if (edge / (sum * sum) < 1 / 65535) { half--; break; }
        }
    }
    // Leave room for at least two output pixels within each bounded read.
    if (half > 511) throw new Error("SSIM radius exceeds 511");
    const size = half * 2 + 1, chunk = 1024 - half * 2;
    const weights = Array.from({ length: size }, (_, i) => sigma <= 1e-12
        ? (i === half ? 1 : 0) : Math.exp(-((i - half) ** 2) / (2 * sigma ** 2)));
    const weightSum = weights.reduce((sum, value) => sum + value, 0);
    for (let i = 0; i < weights.length; i++)
        weights[i] = weights[i]! / weightSum;
    let similarity = 0, area = 0;
    for (let y = 0; y < height; y++) {
        // Include the halo in the 1024-pixel read limit. Copy borrowed reads
        // because all window rows must remain available across requests.
        for (let left = 0; left < width; left += chunk) {
            yield;
            const count = Math.min(chunk, width - left);
            const maskA = yield* readCompareMaskSteps(imgA, 0, left - half, y - half, count);
            const maskB = yield* readCompareMaskSteps(imgB, 1, left - half, y - half, count);
            const rows: CompareSamples[][] = [[], []];
            const starts: number[] = [];
            for (const image of [0, 1] as const) {
                const info = image === 0 ? imgA : imgB;
                const start = Math.min(info.width - 1, Math.max(0, left - half));
                const end = Math.min(info.width, left + count + half);
                starts[image] = start;
                for (let v = -half; v <= half; v++) {
                    const row = Math.max(0, Math.min(info.height - 1, y + v));
                    const length = (end - start) * 4;
                    const data = yield { kind: "read", image, position: (row * info.width + start) * 4, length };
                    if (!data || data.length !== length / 4 * (info.space === "cmyk" ? 5 : 4))
                        throw new Error("Truncated comparison pixels");
                    rows[image]!.push(data.slice());
                }
            }
            for (let x = left; x < left + count; x++) {
                yield;
                if (maskA?.[x - left] === 0 || maskB?.[x - left] === 0) continue;
                area++;
                for (const channel of selected) {
                    let muA = 0, muB = 0, squareA = 0, squareB = 0, product = 0;
                    for (let v = 0; v < size; v++) {
                        for (let u = 0; u < size; u++) {
                            const offsetA = (Math.max(0, Math.min(imgA.width - 1, x + u - half)) - starts[0]!) * (imgA.space === "cmyk" ? 5 : 4) + channel;
                            const offsetB = (Math.max(0, Math.min(imgB.width - 1, x + u - half)) - starts[1]!) * (imgB.space === "cmyk" ? 5 : 4) + channel;
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
    const distortion = (1 - similarity / (Math.max(1, area) * selected.length)) / 2;
    return Math.abs(distortion) < 1e-12 ? 0 : distortion;
}

// PHASE correlates LoG:0,1 edge surfaces per channel. Keep signed HDRI
// values: rounding or clamping the convolution changes the metric.
function* comparePhaseSteps(imgA: CompareImage, imgB: CompareImage, selected: readonly number[]): Generator<CompareRequest | undefined, number, CompareSamples | undefined> {
    if (selected.length === 0) return 0;
    const width = Math.max(imgA.width, imgB.width), height = Math.max(imgA.height, imgB.height);
    const channels = imgA.space === "cmyk" && imgB.space === "cmyk" ? 5 : imgA.hasAlpha && imgB.hasAlpha ? 4 : 3;
    const kernel = Array.from({ length: 81 }, (_, i) => {
        const radius = ((i % 9 - 4) ** 2 + (Math.floor(i / 9) - 4) ** 2) / 2;
        return (1 - radius) * Math.exp(-radius) / Math.PI;
    });
    const positive = kernel.reduce((sum, weight) => sum + Math.max(0, weight), 0);
    const negative = kernel.reduce((sum, weight) => sum - Math.min(0, weight), 0);
    for (let i = 0; i < kernel.length; i++) kernel[i]! /= kernel[i]! >= 0 ? positive : negative;
    const stats = Array.from({ length: channels }, () => ({ a: 0, b: 0, aa: 0, bb: 0, ab: 0 }));
    let area = 0;
    for (let y = 0; y < height; y++) for (let left = 0; left < width; left += 1016) {
        yield;
        const count = Math.min(1016, width - left);
        const maskA = yield* readCompareMaskSteps(imgA, 0, left, y, count);
        const maskB = yield* readCompareMaskSteps(imgB, 1, left, y, count);
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
                if (!bytes || bytes.length !== length / 4 * (info.space === "cmyk" ? 5 : 4)) throw new Error("Truncated comparison pixels");
                for (let x = 0; x < count; x++) for (let u = -4; u <= 4; u++) {
                    const column = Math.max(0, Math.min(info.width - 1, Math.min(left + x, info.width - 1) + u));
                    const offset = (column - start) * (info.space === "cmyk" ? 5 : 4);
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
                for (let channel = 0; channel < channels; channel++) if (channel !== 3) surface[x * channels + channel]! *= reciprocal;
            }
            // Q16-HDRI stores each convolved sample as a float Quantum.
            for (let i = 0; i < surface.length; i++) surface[i] = Math.fround(surface[i]! * 65535) / 65535;
            surfaces.push(surface);
        }
        for (let x = 0; x < count; x++) {
            if (maskA?.[x] === 0 || maskB?.[x] === 0) continue;
            area++;
            for (let channel = 0; channel < channels; channel++) {
                const a = surfaces[0]![x * channels + channel]!, b = surfaces[1]![x * channels + channel]!;
                const stat = stats[channel]!;
                stat.a += a; stat.b += b; stat.aa += a * a; stat.bb += b * b; stat.ab += a * b;
            }
        }
    }
    area = Math.max(1, area);
    let similarity = 0;
    for (const channel of selected) {
        const stat = stats[channel]!;
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
    const distortion = (1 - similarity / selected.length) / 2;
    return Math.abs(distortion) < 1e-12 ? 0 : distortion;
}
