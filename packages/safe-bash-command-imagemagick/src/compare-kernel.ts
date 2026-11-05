import type { RgbaColor } from "@poe-code/image-ast/portable";
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
    readonly dissimilarityThreshold?: number;
    readonly diff: boolean;
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
}
/** Borrow input ranges until the next request; output chunks are owned by the receiver. */
export function* compareImageSteps(imgA: CompareImage, imgB: CompareImage, options: CompareOptions): Generator<CompareRequest | undefined, CompareResult, Uint8Array | undefined> {
    const { metric, fuzz, highlightColor, lowlightColor, composeSrc, dissimilarityThreshold } = options;
    const width = Math.max(imgA.width, imgB.width);
    const height = Math.max(imgA.height, imgB.height);
    const totalPixels = Math.max(1, width * height);
    let aeCount = 0;
    let aeMagnitude = 0;
    let sumAbs = 0;
    let sumSq = 0;
    let maxAbs = 0;
    let sumLumA = 0;
    let sumLumB = 0;
    let sumLumSqA = 0;
    let sumLumSqB = 0;
    let sumLumAB = 0;
    const hasAlpha = imgA.hasAlpha || imgB.hasAlpha;
    const nccChannels = metric === "ncc" ? Array.from({ length: imgA.hasAlpha && imgB.hasAlpha ? 4 : 3 }, () => ({
        rawA: 0, rawB: 0, sumA: 0, sumB: 0, squareA: 0, squareB: 0, product: 0
    })) : [];
    for (let y = 0; y < height; y++) {
        if ((y & 511) === 511)
            yield;
        for (let left = 0; left < width; left += 1024) {
            yield;
            const count = Math.min(1024, width - left);
            let dataA: Uint8Array | undefined, dataB: Uint8Array | undefined;
            if (y < imgA.height && left < imgA.width) {
                const length = Math.min(count, imgA.width - left) * 4;
                dataA = yield { kind: "read", image: 0, position: (y * imgA.width + left) * 4, length };
                if (!(dataA instanceof Uint8Array) || dataA.length !== length)
                    throw new Error("Truncated comparison pixels");
                dataA = dataA.slice();
            }
            if (y < imgB.height && left < imgB.width) {
                const length = Math.min(count, imgB.width - left) * 4;
                dataB = yield { kind: "read", image: 1, position: (y * imgB.width + left) * 4, length };
                if (!(dataB instanceof Uint8Array) || dataB.length !== length)
                    throw new Error("Truncated comparison pixels");
            }
            const diffData = options.diff ? new Uint8Array(count * 4) : undefined;
            for (let x = left; x < left + count; x++) {
                const outOff = (x - left) * 4;
                const inBoundsA = x < imgA.width && y < imgA.height;
                const inBoundsB = x < imgB.width && y < imgB.height;
                const offA = inBoundsA ? (x - left) * 4 : -1;
                const offB = inBoundsB ? (x - left) * 4 : -1;
                const rA = offA >= 0 ? dataA![offA]! : 0;
                const gA = offA >= 0 ? dataA![offA + 1]! : 0;
                const bA = offA >= 0 ? dataA![offA + 2]! : 0;
                const aA = offA >= 0 ? dataA![offA + 3]! : 0;
                const rB = offB >= 0 ? dataB![offB]! : 0;
                const gB = offB >= 0 ? dataB![offB + 1]! : 0;
                const bB = offB >= 0 ? dataB![offB + 2]! : 0;
                const aB = offB >= 0 ? dataB![offB + 3]! : 0;
                // NCC centers each channel on its unassociated mean, then
                // combines covariance and variance across all active channels.
                for (let channel = 0; channel < nccChannels.length; channel++) {
                    const stats = nccChannels[channel]!;
                    const rawA = offA >= 0 ? dataA![offA + channel]! : 0;
                    const rawB = offB >= 0 ? dataB![offB + channel]! : 0;
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
                // AE sums channel magnitudes above fuzz, then averages over channels.
                const aeR = hasAlpha ? pdr : dr, aeG = hasAlpha ? pdg : dg, aeB = hasAlpha ? pdb : db;
                aeMagnitude += (aeR > fuzz ? aeR : 0) + (aeG > fuzz ? aeG : 0) + (aeB > fuzz ? aeB : 0) + (hasAlpha && da > fuzz ? da : 0);
                const maxDelta = hasAlpha ? Math.max(pdr, pdg, pdb, da) : Math.max(dr, dg, db);
                if (!inBoundsA || !inBoundsB || maxDelta > fuzz) {
                    aeCount++;
                    if (diffData) {
                        diffData[outOff] = highlightColor.r;
                        diffData[outOff + 1] = highlightColor.g;
                        diffData[outOff + 2] = highlightColor.b;
                        diffData[outOff + 3] = highlightColor.a;
                    }
                }
                else if (diffData) {
                    if (composeSrc) {
                        diffData[outOff] = 0;
                        diffData[outOff + 1] = 0;
                        diffData[outOff + 2] = 0;
                        diffData[outOff + 3] = 0;
                    }
                    else if (lowlightColor) {
                        diffData[outOff] = lowlightColor.r;
                        diffData[outOff + 1] = lowlightColor.g;
                        diffData[outOff + 2] = lowlightColor.b;
                        diffData[outOff + 3] = lowlightColor.a;
                    }
                    else {
                        diffData[outOff] = Math.round(rA * 0.3 + 255 * 0.7);
                        diffData[outOff + 1] = Math.round(gA * 0.3 + 255 * 0.7);
                        diffData[outOff + 2] = Math.round(bA * 0.3 + 255 * 0.7);
                        diffData[outOff + 3] = 255;
                    }
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
                const lA = (0.299 * rA + 0.587 * gA + 0.114 * bA) / 255;
                const lB = (0.299 * rB + 0.587 * gB + 0.114 * bB) / 255;
                sumLumA += lA;
                sumLumB += lB;
                sumLumSqA += lA * lA;
                sumLumSqB += lB * lB;
                sumLumAB += lA * lB;
            }
            if (diffData)
                yield { kind: "write", position: (y * width + left) * 4, data: diffData };
        }
    }
    const numCh = hasAlpha ? 4 : 3;
    const maeNorm = sumAbs / (totalPixels * numCh * 255);
    const mseNorm = sumSq / (totalPixels * numCh * 255 * 255);
    const rmseNorm = Math.sqrt(mseNorm);
    const paeNorm = maxAbs / 255;
    const muA = sumLumA / totalPixels;
    const muB = sumLumB / totalPixels;
    const varA = Math.max(0, sumLumSqA / totalPixels - muA * muA);
    const varB = Math.max(0, sumLumSqB / totalPixels - muB * muB);
    const covAB = sumLumAB / totalPixels - muA * muB;
    const c1 = 0.0001;
    const c2 = 0.0009;
    const ssim = ((2 * muA * muB + c1) * (2 * covAB + c2)) /
        ((muA * muA + muB * muB + c1) * (varA + varB + c2));
    let metricStr: string;
    switch (metric) {
        case "ae":
            metricStr = `${formatSignificantMetric(aeMagnitude / (numCh * 255))} (${formatSignificantMetric(aeMagnitude / (totalPixels * numCh * 255))})`;
            break;
        case "mae":
            metricStr = `${formatMetricNum(maeNorm * 65535)} (${formatMetricNum(maeNorm)})`;
            break;
        case "mse":
            metricStr = `${formatMetricNum(mseNorm * 65535)} (${formatMetricNum(mseNorm)})`;
            break;
        case "pae":
            metricStr = `${formatMetricNum(paeNorm * 65535)} (${formatMetricNum(paeNorm)})`;
            break;
        case "psnr":
            metricStr = mseNorm === 0 ? "120 (1)" : formatMetricNum(10 * Math.log10(1 / mseNorm));
            break;
        case "ssim": {
            const distortion = yield* compareSsimSteps(imgA, imgB);
            metricStr = `${formatSignificantMetric(distortion * 65535)} (${formatSignificantMetric(distortion)})`;
            break;
        }
        case "dssim":
            metricStr = formatMetricNum((1 - ssim) / 2);
            break;
        case "ncc": {
            let varianceA = 0, varianceB = 0, covariance = 0;
            for (const stats of nccChannels) {
                const meanA = stats.rawA / (imgA.width * imgA.height);
                const meanB = stats.rawB / (imgB.width * imgB.height);
                varianceA += Math.max(0, stats.squareA - 2 * meanA * stats.sumA + totalPixels * meanA * meanA);
                varianceB += Math.max(0, stats.squareB - 2 * meanB * stats.sumB + totalPixels * meanB * meanB);
                covariance += stats.product - meanA * stats.sumB - meanB * stats.sumA + totalPixels * meanA * meanB;
            }
            const denominator = Math.sqrt(varianceA) * Math.sqrt(varianceB);
            const similarity = denominator === 0 ? 0 : covariance / denominator;
            const distortion = Math.abs(1 - similarity) < 2e-12 ? 0 : (1 - similarity) / 2;
            metricStr = `${formatSignificantMetric(distortion * 65535)} (${formatSignificantMetric(distortion)})`;
            break;
        }
        case "rmse":
        default:
            metricStr = `${formatMetricNum(rmseNorm * 65535)} (${formatMetricNum(rmseNorm)})`;
            break;
    }
    const exitCode = metric === "psnr" && mseNorm === 0 ? 1 : dissimilarityThreshold !== undefined ? (rmseNorm > dissimilarityThreshold ? 1 : 0) : (aeCount > 0 ? 1 : 0);
    return { width, height, metric: metricStr, exitCode };
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
