// Adapted from @stacksjs/ts-webp 0.1.7 (MIT) and libwebp. See ../../../LICENSE.webp.
import { ZIGZAG } from './tables.js';
const MAX_LEVEL = 2047;
export function quantizeBlock(raster: Int16Array, rasterOff: number, zigzag: Int16Array, zigzagOff: number, dqDc: number, dqAc: number): boolean {
    let nonZero = false;
    for (let n = 0; n < 16; n++) {
        const j = ZIGZAG[n]!;
        const Q = n === 0 ? dqDc : dqAc;
        const c = raster[rasterOff + j]!;
        const sign = c < 0;
        const mag = sign ? -c : c;
        let level = ((mag + (Q >> 1)) / Q) | 0;
        if (level > MAX_LEVEL)
            level = MAX_LEVEL;
        const signedLevel = sign ? -level : level;
        zigzag[zigzagOff + n]! = signedLevel;
        raster[rasterOff + j]! = signedLevel * Q;
        if (level !== 0)
            nonZero = true;
    }
    return nonZero;
}
