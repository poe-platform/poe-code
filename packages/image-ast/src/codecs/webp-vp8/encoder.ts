// Adapted from @stacksjs/ts-webp 0.1.7 (MIT) and libwebp. See ../../../LICENSE.webp.
import type { WebpImageData } from '@stacksjs/ts-webp';
import { sharpRgbToYuv420 } from './sharp-yuv.js';
import { BoolEncoder } from './bool-encoder.js';
import { fwht4x4 } from './fdct.js';
import { idct4x4Add, iwht4x4 } from './idct.js';
const BPS = 32;
import { quantizeBlock } from './quant-enc.js';
import { AC_QUANT, CAT3_PROBS, CAT4_PROBS, CAT5_PROBS, CAT6_PROBS, COEF_BANDS, COEF_UPDATE_PROBS, DC_QUANT, DEFAULT_COEF_PROBS, NUM_COEF_BANDS, clampQi, } from './tables.js';
const BLOCK_TYPE_Y_AFTER_Y2 = 0;
const BLOCK_TYPE_Y2 = 1;
const BLOCK_TYPE_UV = 2;
const NUM_LITERAL_PROBS = 11;
const I16_DC_PRED = 0;
export interface VP8EncodeOptions {
    quality?: number;
    effort?: number;
    smartSubsample?: boolean;
}
export function encodeVP8(image: WebpImageData, options: VP8EncodeOptions = {}, probabilities = DEFAULT_COEF_PROBS): Uint8Array {
    const { width, height, data } = image;
    if (width <= 0 || height <= 0)
        throw new Error('VP8: width and height must be positive');
    if (width > 16383 || height > 16383)
        throw new Error('VP8: dimensions cap at 16383');
    const baseQ = options.quality ?? 60;
    if (baseQ < 0 || baseQ > 127)
        throw new Error('VP8: quality must be 0..127');
    const effort = options.effort ?? 4;
    if (!Number.isInteger(effort) || effort < 0 || effort > 6)
        throw new RangeError("WebP effort must be an integer from 0 to 6");
    // Method 0 uses standard probabilities; methods 1–6 fit progressively more macroblocks.
    const counts = effort > 0 ? new Uint32Array(DEFAULT_COEF_PROBS.length * 2) : undefined;
    const mbW = (width + 15) >> 4;
    const mbH = (height + 15) >> 4;
    const ySize = mbW * 16 * mbH * 16;
    const uvSize = mbW * 8 * mbH * 8;
    const Y = new Uint8Array(ySize);
    const U = new Uint8Array(uvSize);
    const V = new Uint8Array(uvSize);
    (options.smartSubsample ? sharpRgbToYuv420 : rgbToYuv420)(data, width, height, mbW * 16, mbH * 16, Y, U, V);
    const Yrec = new Uint8Array(ySize);
    const Urec = new Uint8Array(uvSize);
    const Vrec = new Uint8Array(uvSize);
    const y1Dc = DC_QUANT[clampQi(baseQ)]!;
    const y1Ac = AC_QUANT[clampQi(baseQ)]!;
    const y2Dc = DC_QUANT[clampQi(baseQ)]! * 2;
    let y2Ac = (AC_QUANT[clampQi(baseQ)]! * 101581) >> 16;
    if (y2Ac < 8)
        y2Ac = 8;
    const uvDc = DC_QUANT[clampQi(baseQ) > 117 ? 117 : clampQi(baseQ)]!;
    const uvAc = AC_QUANT[clampQi(baseQ)]!;
    const bw = new BoolEncoder(Math.max(1024, mbW * mbH * 8));
    const tokens = new BoolEncoder(Math.max(1024, mbW * mbH * 32));
    bw.writeBitUniform(0);
    bw.writeBitUniform(0);
    bw.writeBitUniform(0);
    bw.writeBitUniform(0);
    bw.writeLiteral(0, 6);
    bw.writeLiteral(0, 3);
    bw.writeBitUniform(0);
    bw.writeLiteral(0, 2);
    bw.writeLiteral(baseQ, 7);
    for (let i = 0; i < 5; i++)
        bw.writeBitUniform(0);
    bw.writeBitUniform(0);
    emitCoefProbUpdate(bw, probabilities);
    bw.writeBitUniform(0);
    const topNzY = new Uint8Array(mbW * 4);
    const topNzU = new Uint8Array(mbW * 2);
    const topNzV = new Uint8Array(mbW * 2);
    const topNzDc = new Uint8Array(mbW);
    const yBlock = new Uint8Array(BPS * 17);
    const uBlock = new Uint8Array(BPS * 9);
    const vBlock = new Uint8Array(BPS * 9);
    const yResidual = new Int16Array(16 * 16);
    const uResidual = new Int16Array(4 * 16);
    const vResidual = new Int16Array(4 * 16);
    const dcArr = new Int16Array(16);
    const yLevels = new Int16Array(16 * 16);
    const uLevels = new Int16Array(4 * 16);
    const vLevels = new Int16Array(4 * 16);
    const y2Levels = new Int16Array(16);
    for (let my = 0; my < mbH; my++) {
        let leftNzY = 0;
        let leftNzU = 0;
        let leftNzV = 0;
        let leftNzDc = 0;
        for (let mx = 0; mx < mbW; mx++) {
            const sampled = counts && (my * mbW + mx) * 6 < mbW * mbH * effort ? counts : undefined;
            gatherY16(Y, Yrec, mbW * 16, mx, my, yBlock);
            gatherUV(U, Urec, mbW * 8, mx, my, uBlock);
            gatherUV(V, Vrec, mbW * 8, mx, my, vBlock);
            const yPred = dcPredict16(yBlock, mx, my);
            const uPred = dcPredict8(uBlock, mx, my);
            const vPred = dcPredict8(vBlock, mx, my);
            computeResidual16(yBlock, yPred, yResidual);
            computeResidual8(uBlock, uPred, uResidual);
            computeResidual8(vBlock, vPred, vResidual);
            for (let by = 0; by < 4; by++) {
                for (let bx = 0; bx < 4; bx++) {
                    const bIdx = by * 4 + bx;
                    fdct4x4Residual(yResidual, by * 4, bx * 4, yLevels.subarray(bIdx * 16, bIdx * 16 + 16) as unknown as Int16Array);
                }
            }
            for (let i = 0; i < 16; i++) {
                dcArr[i]! = yLevels[i * 16]!;
                yLevels[i * 16]! = 0;
            }
            fwht4x4(dcArr, 0, y2Levels, 0);
            const y2Quant = new Int16Array(16);
            const y2Nz = quantizeBlock(y2Levels, 0, y2Quant, 0, y2Dc, y2Ac);
            const yQuant = new Int16Array(16 * 16);
            const yNzs = new Uint8Array(16);
            for (let i = 0; i < 16; i++) {
                const nz = quantizeBlock(yLevels, i * 16, yQuant, i * 16, y1Dc, y1Ac);
                yNzs[i]! = nz ? 1 : 0;
            }
            for (let i = 0; i < 4; i++) {
                fdct4x4Residual(uResidual, (i >> 1) * 4, (i & 1) * 4, uLevels.subarray(i * 16, i * 16 + 16) as unknown as Int16Array, 8);
                fdct4x4Residual(vResidual, (i >> 1) * 4, (i & 1) * 4, vLevels.subarray(i * 16, i * 16 + 16) as unknown as Int16Array, 8);
            }
            const uQuant = new Int16Array(4 * 16);
            const vQuant = new Int16Array(4 * 16);
            const uNzs = new Uint8Array(4);
            const vNzs = new Uint8Array(4);
            for (let i = 0; i < 4; i++) {
                uNzs[i]! = quantizeBlock(uLevels, i * 16, uQuant, i * 16, uvDc, uvAc) ? 1 : 0;
                vNzs[i]! = quantizeBlock(vLevels, i * 16, vQuant, i * 16, uvDc, uvAc) ? 1 : 0;
            }
            reconstructY16(y2Levels, yLevels, yPred, Yrec, mbW * 16, mx, my);
            reconstructChroma(uLevels, uPred, Urec, mbW * 8, mx, my);
            reconstructChroma(vLevels, vPred, Vrec, mbW * 8, mx, my);
            bw.writeBit(145, 1);
            putI16Mode(bw, I16_DC_PRED);
            putUVMode(bw, I16_DC_PRED);
            const ctxY2 = topNzDc[mx]! + leftNzDc;
            putBlockCoeffs(tokens, probabilities, sampled, y2Quant, BLOCK_TYPE_Y2, ctxY2, 0, y2Nz);
            const y2NzFlag = y2Nz ? 1 : 0;
            topNzDc[mx]! = leftNzDc = y2NzFlag;
            for (let by = 0; by < 4; by++) {
                let l = (leftNzY >>> by) & 1;
                for (let bx = 0; bx < 4; bx++) {
                    const bIdx = by * 4 + bx;
                    const ctx = l + topNzY[mx * 4 + bx]!;
                    const blockNz = yNzs[bIdx]!;
                    putBlockCoeffs(tokens, probabilities, sampled, yQuant, BLOCK_TYPE_Y_AFTER_Y2, ctx, bIdx * 16, !!blockNz, 1);
                    l = blockNz;
                    topNzY[mx * 4 + bx]! = blockNz;
                }
                leftNzY = (leftNzY & ~(1 << by)) | (l << by);
            }
            for (let by = 0; by < 2; by++) {
                let l = (leftNzU >>> by) & 1;
                for (let bx = 0; bx < 2; bx++) {
                    const bIdx = by * 2 + bx;
                    const ctx = l + topNzU[mx * 2 + bx]!;
                    const nz = uNzs[bIdx]!;
                    putBlockCoeffs(tokens, probabilities, sampled, uQuant, BLOCK_TYPE_UV, ctx, bIdx * 16, !!nz);
                    l = nz;
                    topNzU[mx * 2 + bx]! = nz;
                }
                leftNzU = (leftNzU & ~(1 << by)) | (l << by);
            }
            for (let by = 0; by < 2; by++) {
                let l = (leftNzV >>> by) & 1;
                for (let bx = 0; bx < 2; bx++) {
                    const bIdx = by * 2 + bx;
                    const ctx = l + topNzV[mx * 2 + bx]!;
                    const nz = vNzs[bIdx]!;
                    putBlockCoeffs(tokens, probabilities, sampled, vQuant, BLOCK_TYPE_UV, ctx, bIdx * 16, !!nz);
                    l = nz;
                    topNzV[mx * 2 + bx]! = nz;
                }
                leftNzV = (leftNzV & ~(1 << by)) | (l << by);
            }
        }
    }
    const partition0 = bw.finish();
    const tokenPart = tokens.finish();
    const firstPartSize = partition0.length;
    const total = 10 + firstPartSize + tokenPart.length;
    const out = new Uint8Array(total);
    const frameTag = (firstPartSize << 5) | (1 << 4) | 0;
    out[0]! = frameTag & 0xFF;
    out[1]! = (frameTag >> 8) & 0xFF;
    out[2]! = (frameTag >> 16) & 0xFF;
    out[3]! = 0x9D;
    out[4]! = 0x01;
    out[5]! = 0x2A;
    out[6]! = width & 0xFF;
    out[7]! = (width >> 8) & 0x3F;
    out[8]! = height & 0xFF;
    out[9]! = (height >> 8) & 0x3F;
    out.set(partition0, 10);
    out.set(tokenPart, 10 + firstPartSize);
    if (counts) {
        const fitted = probabilities.slice();
        for (let i = 0; i < fitted.length; i++) {
            const zero = counts[i * 2]!, one = counts[i * 2 + 1]!, total = zero + one;
            if (!total)
                continue;
            const p = Math.max(1, Math.min(255, Math.round(256 * zero / total)));
            const cost = (prob: number) => -zero * Math.log2(prob / 256) - one * Math.log2(1 - prob / 256);
            // Include the eight-bit probability and the update flag in the estimated cost.
            const update = COEF_UPDATE_PROBS[i]! / 256;
            if (cost(probabilities[i]!) - cost(p) > 8 + Math.log2(update / (1 - update)))
                fitted[i]! = p;
        }
        const optimized = encodeVP8(image, { ...options, quality: baseQ, effort: 0 }, fitted);
        // Sparse images can cost more in update headers than they save in token bits.
        return optimized.length < out.length ? optimized : out;
    }
    return out;
}
function rgbToYuv420(rgba: Uint8Array, width: number, height: number, paddedW: number, paddedH: number, Y: Uint8Array, U: Uint8Array, V: Uint8Array): void {
    for (let y = 0; y < paddedH; y++) {
        const sy = y < height ? y : height - 1;
        for (let x = 0; x < paddedW; x++) {
            const sx = x < width ? x : width - 1;
            const o = (sy * width + sx) * 4;
            const r = rgba[o]!;
            const g = rgba[o + 1]!;
            const b = rgba[o + 2]!;
            const yv = ((66 * r + 129 * g + 25 * b + 128) >> 8) + 16;
            Y[y * paddedW + x]! = yv < 0 ? 0 : yv > 255 ? 255 : yv;
            if ((y & 1) === 0 && (x & 1) === 0) {
                const avgR = r;
                const avgG = g;
                const avgB = b;
                const uv = ((-38 * avgR - 74 * avgG + 112 * avgB + 128) >> 8) + 128;
                const vv = ((112 * avgR - 94 * avgG - 18 * avgB + 128) >> 8) + 128;
                U[(y >> 1) * (paddedW >> 1) + (x >> 1)]! = uv < 0 ? 0 : uv > 255 ? 255 : uv;
                V[(y >> 1) * (paddedW >> 1) + (x >> 1)]! = vv < 0 ? 0 : vv > 255 ? 255 : vv;
            }
        }
    }
}
function gatherY16(Y: Uint8Array, Yr: Uint8Array, stride: number, mx: number, my: number, dst: Uint8Array): void {
    for (let x = -1; x < 16; x++) {
        const sx = mx * 16 + x;
        const sy = my * 16 - 1;
        dst[(0) * BPS + (x + 1)]! = (sx >= 0 && sy >= 0)
            ? Yr[sy * stride + sx]! : 0x80;
    }
    for (let y = 0; y < 16; y++) {
        const sx = mx * 16 - 1;
        const sy = my * 16 + y;
        dst[(y + 1) * BPS]! = (sx >= 0)
            ? Yr[sy * stride + sx]! : 0x80;
        for (let x = 0; x < 16; x++) {
            dst[(y + 1) * BPS + (x + 1)]! = Y[(my * 16 + y) * stride + (mx * 16 + x)]!;
        }
    }
}
function gatherUV(C: Uint8Array, Cr: Uint8Array, stride: number, mx: number, my: number, dst: Uint8Array): void {
    for (let x = -1; x < 8; x++) {
        const sx = mx * 8 + x;
        const sy = my * 8 - 1;
        dst[(0) * BPS + (x + 1)]! = (sx >= 0 && sy >= 0)
            ? Cr[sy * stride + sx]! : 0x80;
    }
    for (let y = 0; y < 8; y++) {
        const sx = mx * 8 - 1;
        const sy = my * 8 + y;
        dst[(y + 1) * BPS]! = (sx >= 0)
            ? Cr[sy * stride + sx]! : 0x80;
        for (let x = 0; x < 8; x++) {
            dst[(y + 1) * BPS + (x + 1)]! = C[(my * 8 + y) * stride + (mx * 8 + x)]!;
        }
    }
}
function reconstructY16(y2Levels: Int16Array, yLevels: Int16Array, pred: number, Yr: Uint8Array, stride: number, mx: number, my: number): void {
    iwht4x4(y2Levels);
    const patch = new Uint8Array(16 * 16);
    patch.fill(pred);
    for (let by = 0; by < 4; by++) {
        for (let bx = 0; bx < 4; bx++) {
            const bIdx = by * 4 + bx;
            const sub = yLevels.subarray(bIdx * 16, bIdx * 16 + 16);
            sub[0]! = y2Levels[bIdx]!;
            idct4x4Add(sub as unknown as Int16Array, patch, 16, by * 4 * 16 + bx * 4);
        }
    }
    for (let y = 0; y < 16; y++) {
        const row = (my * 16 + y) * stride + mx * 16;
        for (let x = 0; x < 16; x++)
            Yr[row + x]! = patch[y * 16 + x]!;
    }
}
function reconstructChroma(levels: Int16Array, pred: number, Cr: Uint8Array, stride: number, mx: number, my: number): void {
    const patch = new Uint8Array(8 * 8);
    patch.fill(pred);
    for (let i = 0; i < 4; i++) {
        const sub = levels.subarray(i * 16, i * 16 + 16);
        idct4x4Add(sub as unknown as Int16Array, patch, 8, (i >> 1) * 4 * 8 + (i & 1) * 4);
    }
    for (let y = 0; y < 8; y++) {
        const row = (my * 8 + y) * stride + mx * 8;
        for (let x = 0; x < 8; x++)
            Cr[row + x]! = patch[y * 8 + x]!;
    }
}
function dcPredict16(block: Uint8Array, mx: number, my: number): number {
    if (mx === 0 && my === 0)
        return 0x80;
    if (mx === 0) {
        let sum = 8;
        for (let x = 0; x < 16; x++)
            sum += block[(x + 1)]!;
        return sum >> 4;
    }
    if (my === 0) {
        let sum = 8;
        for (let y = 0; y < 16; y++)
            sum += block[(y + 1) * BPS]!;
        return sum >> 4;
    }
    let sum = 16;
    for (let y = 0; y < 16; y++)
        sum += block[(y + 1) * BPS]!;
    for (let x = 0; x < 16; x++)
        sum += block[(x + 1)]!;
    return sum >> 5;
}
function dcPredict8(block: Uint8Array, mx: number, my: number): number {
    if (mx === 0 && my === 0)
        return 0x80;
    if (mx === 0) {
        let sum = 4;
        for (let x = 0; x < 8; x++)
            sum += block[(x + 1)]!;
        return sum >> 3;
    }
    if (my === 0) {
        let sum = 4;
        for (let y = 0; y < 8; y++)
            sum += block[(y + 1) * BPS]!;
        return sum >> 3;
    }
    let sum = 8;
    for (let y = 0; y < 8; y++)
        sum += block[(y + 1) * BPS]!;
    for (let x = 0; x < 8; x++)
        sum += block[(x + 1)]!;
    return sum >> 4;
}
function computeResidual16(block: Uint8Array, pred: number, residual: Int16Array): void {
    for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
            residual[y * 16 + x]! = block[(y + 1) * BPS + (x + 1)]! - pred;
        }
    }
}
function computeResidual8(block: Uint8Array, pred: number, residual: Int16Array): void {
    for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
            residual[y * 8 + x]! = block[(y + 1) * BPS + (x + 1)]! - pred;
        }
    }
}
function fdct4x4Residual(residual: Int16Array, subY: number, subX: number, out: Int16Array, stride = 16): void {
    fdct4x4Int16(residual, (subY * stride + subX), stride, out);
}
function fdct4x4Int16(src: Int16Array, srcOff: number, stride: number, out: Int16Array): void {
    const tmp = new Int32Array(16);
    for (let i = 0; i < 4; i++) {
        const off = srcOff + i * stride;
        const d0 = src[off + 0]!;
        const d1 = src[off + 1]!;
        const d2 = src[off + 2]!;
        const d3 = src[off + 3]!;
        const a0 = d0 + d3;
        const a1 = d1 + d2;
        const a2 = d1 - d2;
        const a3 = d0 - d3;
        tmp[0 + i * 4]! = (a0 + a1) * 8;
        tmp[1 + i * 4]! = (a2 * 2217 + a3 * 5352 + 1812) >> 9;
        tmp[2 + i * 4]! = (a0 - a1) * 8;
        tmp[3 + i * 4]! = (a3 * 2217 - a2 * 5352 + 937) >> 9;
    }
    for (let i = 0; i < 4; i++) {
        const a0 = tmp[0 + i]! + tmp[12 + i]!;
        const a1 = tmp[4 + i]! + tmp[8 + i]!;
        const a2 = tmp[4 + i]! - tmp[8 + i]!;
        const a3 = tmp[0 + i]! - tmp[12 + i]!;
        out[0 + i]! = (a0 + a1 + 7) >> 4;
        out[4 + i]! = ((a2 * 2217 + a3 * 5352 + 12000) >> 16) + (a3 !== 0 ? 1 : 0);
        out[8 + i]! = (a0 - a1 + 7) >> 4;
        out[12 + i]! = (a3 * 2217 - a2 * 5352 + 51000) >> 16;
    }
}
function putI16Mode(bw: BoolEncoder, mode: number): void {
    if (mode === 0 || mode === 1) {
        bw.writeBit(156, 0);
        bw.writeBit(163, mode === 1 ? 1 : 0);
    }
    else {
        bw.writeBit(156, 1);
        bw.writeBit(128, mode === 2 ? 1 : 0);
    }
}
function putUVMode(bw: BoolEncoder, mode: number): void {
    if (mode === 0) {
        bw.writeBit(142, 0);
    }
    else if (mode === 2) {
        bw.writeBit(142, 1);
        bw.writeBit(114, 0);
    }
    else if (mode === 3) {
        bw.writeBit(142, 1);
        bw.writeBit(114, 1);
        bw.writeBit(183, 0);
    }
    else {
        bw.writeBit(142, 1);
        bw.writeBit(114, 1);
        bw.writeBit(183, 1);
    }
}
function emitCoefProbUpdate(bw: BoolEncoder, probabilities: Uint8Array): void {
    for (let i = 0; i < probabilities.length; i++) {
        const changed = probabilities[i]! !== DEFAULT_COEF_PROBS[i]!;
        bw.writeBit(COEF_UPDATE_PROBS[i]!, changed ? 1 : 0);
        if (changed)
            bw.writeLiteral(probabilities[i]!, 8);
    }
}
function probSlice(probs: Uint8Array, blockType: number, band: number, ctx: number): Uint8Array {
    const off = blockType * NUM_COEF_BANDS * 3 * NUM_LITERAL_PROBS
        + band * 3 * NUM_LITERAL_PROBS
        + ctx * NUM_LITERAL_PROBS;
    return probs.subarray(off, off + NUM_LITERAL_PROBS);
}
function putBlockCoeffs(bw: BoolEncoder, probabilities: Uint8Array, counts: Uint32Array | undefined, zigzagLevels: Int16Array, blockType: number, ctx: number, blockOff: number, blockNz: boolean, firstCoef = 0): void {
    let last = -1;
    for (let n = firstCoef; n < 16; n++) {
        if (zigzagLevels[blockOff + n]! !== 0)
            last = n;
    }
    void blockNz;
    let n = firstCoef;
    let p = probSlice(probabilities, blockType, COEF_BANDS[n]!, ctx);
    const bit = (index: number, value: number) => {
        if (counts)
            counts[(p.byteOffset - probabilities.byteOffset + index) * 2 + value]!++;
        bw.writeBit(p[index]!, value);
    };
    bit(0, last >= 0 ? 1 : 0);
    if (last < 0)
        return;
    while (n < 16) {
        const c = zigzagLevels[blockOff + n++]!;
        const sign = c < 0;
        let v = sign ? -c : c;
        if (v === 0) {
            bit(1, 0);
            p = probSlice(probabilities, blockType, COEF_BANDS[n]!, 0);
            continue;
        }
        bit(1, 1);
        if (v === 1) {
            bit(2, 0);
            p = probSlice(probabilities, blockType, COEF_BANDS[n]!, 1);
        }
        else {
            bit(2, 1);
            if (v <= 4) {
                bit(3, 0);
                if (v === 2) {
                    bit(4, 0);
                }
                else {
                    bit(4, 1);
                    bit(5, v === 4 ? 1 : 0);
                }
            }
            else {
                bit(3, 1);
                if (v <= 10) {
                    bit(6, 0);
                    if (v <= 6) {
                        bit(7, 0);
                        bw.writeBit(159, v === 6 ? 1 : 0);
                    }
                    else {
                        bit(7, 1);
                        bw.writeBit(165, v >= 9 ? 1 : 0);
                        bw.writeBit(145, !(v & 1) ? 1 : 0);
                    }
                }
                else {
                    bit(6, 1);
                    let mask: number;
                    let tab: Uint8Array;
                    if (v < 3 + (8 << 1)) {
                        bit(8, 0);
                        bit(9, 0);
                        v -= 3 + (8 << 0);
                        mask = 1 << 2;
                        tab = CAT3_PROBS;
                    }
                    else if (v < 3 + (8 << 2)) {
                        bit(8, 0);
                        bit(9, 1);
                        v -= 3 + (8 << 1);
                        mask = 1 << 3;
                        tab = CAT4_PROBS;
                    }
                    else if (v < 3 + (8 << 3)) {
                        bit(8, 1);
                        bit(10, 0);
                        v -= 3 + (8 << 2);
                        mask = 1 << 4;
                        tab = CAT5_PROBS;
                    }
                    else {
                        bit(8, 1);
                        bit(10, 1);
                        v -= 3 + (8 << 3);
                        mask = 1 << 10;
                        tab = CAT6_PROBS;
                    }
                    let t = 0;
                    while (mask) {
                        bw.writeBit(tab[t++]!, (v & mask) ? 1 : 0);
                        mask >>= 1;
                    }
                }
            }
            p = probSlice(probabilities, blockType, COEF_BANDS[n]!, 2);
        }
        bw.writeBitUniform(sign ? 1 : 0);
        if (n === 16)
            return;
        if (n > last) {
            bit(0, 0);
            return;
        }
        bit(0, 1);
    }
}
