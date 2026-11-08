// Adapted from @stacksjs/ts-webp 0.1.7 (MIT) and libwebp. See ../../../LICENSE.webp.
const KC1 = 20091 + (1 << 16), KC2 = 35468;
function mulC1(v: number): number {
    return Math.imul(v, KC1) >> 16;
}
function mulC2(v: number): number {
    return Math.imul(v, KC2) >> 16;
}
function clip8(v: number): number {
    return v < 0 ? 0 : v > 255 ? 255 : v;
}
export function idct4x4Add(coeffs: Int16Array, dst: Uint8Array, dstStride: number, dstOffset: number): void {
    const C = new Int32Array(16);
    for (let i = 0; i < 4; i++) {
        const a = coeffs[i + 0]! + coeffs[i + 8]!;
        const b = coeffs[i + 0]! - coeffs[i + 8]!;
        const c = mulC2(coeffs[i + 4]!) - mulC1(coeffs[i + 12]!);
        const d = mulC1(coeffs[i + 4]!) + mulC2(coeffs[i + 12]!);
        C[i * 4 + 0]! = a + d;
        C[i * 4 + 1]! = b + c;
        C[i * 4 + 2]! = b - c;
        C[i * 4 + 3]! = a - d;
    }
    for (let i = 0; i < 4; i++) {
        const dc = C[i]! + 4;
        const a = dc + C[i + 8]!;
        const b = dc - C[i + 8]!;
        const c = mulC2(C[i + 4]!) - mulC1(C[i + 12]!);
        const d = mulC1(C[i + 4]!) + mulC2(C[i + 12]!);
        const base = dstOffset + i * dstStride;
        dst[base + 0]! = clip8(dst[base + 0]! + ((a + d) >> 3));
        dst[base + 1]! = clip8(dst[base + 1]! + ((b + c) >> 3));
        dst[base + 2]! = clip8(dst[base + 2]! + ((b - c) >> 3));
        dst[base + 3]! = clip8(dst[base + 3]! + ((a - d) >> 3));
    }
}
export function iwht4x4(io: Int16Array): void {
    const tmp = new Int32Array(16);
    for (let i = 0; i < 4; i++) {
        const a0 = io[i + 0]! + io[i + 12]!;
        const a1 = io[i + 4]! + io[i + 8]!;
        const a2 = io[i + 4]! - io[i + 8]!;
        const a3 = io[i + 0]! - io[i + 12]!;
        tmp[i + 0]! = a0 + a1;
        tmp[i + 8]! = a0 - a1;
        tmp[i + 4]! = a3 + a2;
        tmp[i + 12]! = a3 - a2;
    }
    for (let i = 0; i < 4; i++) {
        const dc = tmp[0 + i * 4]! + 3;
        const a0 = dc + tmp[3 + i * 4]!;
        const a1 = tmp[1 + i * 4]! + tmp[2 + i * 4]!;
        const a2 = tmp[1 + i * 4]! - tmp[2 + i * 4]!;
        const a3 = dc - tmp[3 + i * 4]!;
        io[0 + i * 4]! = (a0 + a1) >> 3;
        io[1 + i * 4]! = (a3 + a2) >> 3;
        io[2 + i * 4]! = (a0 - a1) >> 3;
        io[3 + i * 4]! = (a3 - a2) >> 3;
    }
}
