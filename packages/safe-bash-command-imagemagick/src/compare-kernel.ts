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
    let sumAbs = 0;
    let sumSq = 0;
    let maxAbs = 0;
    let sumLumA = 0;
    let sumLumB = 0;
    let sumLumSqA = 0;
    let sumLumSqB = 0;
    let sumLumAB = 0;
    const hasAlpha = imgA.hasAlpha || imgB.hasAlpha;
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
                const dr = Math.abs(rA - rB);
                const dg = Math.abs(gA - gB);
                const db = Math.abs(bA - bB);
                const da = Math.abs(aA - aB);
                const alphaA = aA / 255;
                const alphaB = aB / 255;
                const pdr = Math.abs(rA * alphaA - rB * alphaB);
                const pdg = Math.abs(gA * alphaA - gB * alphaB);
                const pdb = Math.abs(bA * alphaA - bB * alphaB);
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
    const ncc = varA === 0 && varB === 0 ? 1 : covAB / (Math.sqrt(varA * varB) || 1);
    let metricStr: string;
    switch (metric) {
        case "ae":
            metricStr = String(aeCount);
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
            metricStr = mseNorm === 0 ? "inf" : formatMetricNum(10 * Math.log10(1 / mseNorm));
            break;
        case "ssim":
            metricStr = formatMetricNum(ssim);
            break;
        case "dssim":
            metricStr = formatMetricNum((1 - ssim) / 2);
            break;
        case "ncc":
            metricStr = formatMetricNum(ncc);
            break;
        case "rmse":
        default:
            metricStr = `${formatMetricNum(rmseNorm * 65535)} (${formatMetricNum(rmseNorm)})`;
            break;
    }
    const exitCode = dissimilarityThreshold !== undefined ? (rmseNorm > dissimilarityThreshold ? 1 : 0) : (aeCount > 0 ? 1 : 0);
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
