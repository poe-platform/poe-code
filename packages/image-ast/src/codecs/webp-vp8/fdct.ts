// Adapted from @stacksjs/ts-webp 0.1.7 (MIT) and libwebp. See ../../../LICENSE.webp.
export function fwht4x4(inBuf: Int16Array, inOff: number, out: Int16Array, outOff: number): void {
    const tmp = new Int32Array(16);
    for (let i = 0; i < 4; i++) {
        const a0 = inBuf[inOff + 0 + i * 4]! + inBuf[inOff + 2 + i * 4]!;
        const a1 = inBuf[inOff + 1 + i * 4]! + inBuf[inOff + 3 + i * 4]!;
        const a2 = inBuf[inOff + 1 + i * 4]! - inBuf[inOff + 3 + i * 4]!;
        const a3 = inBuf[inOff + 0 + i * 4]! - inBuf[inOff + 2 + i * 4]!;
        tmp[0 + i * 4]! = a0 + a1;
        tmp[1 + i * 4]! = a3 + a2;
        tmp[2 + i * 4]! = a3 - a2;
        tmp[3 + i * 4]! = a0 - a1;
    }
    for (let i = 0; i < 4; i++) {
        const a0 = tmp[0 + i]! + tmp[8 + i]!;
        const a1 = tmp[4 + i]! + tmp[12 + i]!;
        const a2 = tmp[4 + i]! - tmp[12 + i]!;
        const a3 = tmp[0 + i]! - tmp[8 + i]!;
        out[outOff + 0 + i]! = (a0 + a1) >> 1;
        out[outOff + 4 + i]! = (a3 + a2) >> 1;
        out[outOff + 8 + i]! = (a3 - a2) >> 1;
        out[outOff + 12 + i]! = (a0 - a1) >> 1;
    }
}
