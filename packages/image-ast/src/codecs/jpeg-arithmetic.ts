/* Adapted from IJG jcarith.c / jaricom.c, developed 1997-2009 by Guido Vollbeding.
 * libjpeg-turbo modifications Copyright (C) 2015, 2018, 2021-2022, D. R. Commander.
 * TypeScript adaptation: block streaming and spectral selection, 2026.
 * See ../../LICENSE.jpeg for distribution terms.
 */

// ITU-T T.81 Table D.2: Qe, next MPS state, next LPS state (with sign switch).
const states = new Uint32Array([
  0x5a1d0181, 0x2586020e, 0x11140310, 0x080b0412, 0x03d80514, 0x01da0617,
  0x00e50719, 0x006f081c, 0x0036091e, 0x001a0a21, 0x000d0b23, 0x00060c09,
  0x00030d0a, 0x00010d0c, 0x5a7f0f8f, 0x3f251024, 0x2cf21126, 0x207c1227,
  0x17b91328, 0x1182142a, 0x0cef152b, 0x09a1162d, 0x072f172e, 0x055c1830,
  0x04061931, 0x03031a33, 0x02401b34, 0x01b11c36, 0x01441d38, 0x00f51e39,
  0x00b71f3b, 0x008a203c, 0x0068213e, 0x004e223f, 0x003b2320, 0x002c0921,
  0x5ae125a5, 0x484c2640, 0x3a0d2741, 0x2ef12843, 0x261f2944, 0x1f332a45,
  0x19a82b46, 0x15182c48, 0x11772d49, 0x0e742e4a, 0x0bfb2f4b, 0x09f8304d,
  0x0861314e, 0x0706324f, 0x05cd3330, 0x04de3432, 0x040f3532, 0x03633633,
  0x02d43734, 0x025c3835, 0x01f83936, 0x01a43a37, 0x01603b38, 0x01253c39,
  0x00f63d3a, 0x00cb3e3b, 0x00ab3f3d, 0x008f203d, 0x5b1241c1, 0x4d044250,
  0x412c4351, 0x37d84452, 0x2fe84553, 0x293c4654, 0x23794756, 0x1edf4857,
  0x1aa94957, 0x174e4a48, 0x14244b48, 0x119c4c4a, 0x0f6b4d4a, 0x0d514e4b,
  0x0bb64f4d, 0x0a40304d, 0x583251d0, 0x4d1c5258, 0x438e5359, 0x3bdd545a,
  0x34ee555b, 0x2eae565c, 0x299a575d, 0x25164756, 0x557059d8, 0x4ca95a5f,
  0x44d95b60, 0x3e225c61, 0x38245d63, 0x32b45e63, 0x2e17565d, 0x56a860df,
  0x4f466165, 0x47e56266, 0x41cf6367, 0x3c3d6468, 0x375e5d63, 0x52316669,
  0x4c0f676a, 0x4639686b, 0x415e6367, 0x56276ae9, 0x50e76b6c, 0x4b85676d,
  0x55976d6e, 0x504f6b6f, 0x5a106fee, 0x55226d70, 0x59eb6ff0, 0x5a1d7171,
]);

/** Adaptive JPEG entropy coding, with default DAC conditioning L=0, U=1, K=5. */
export function createJpegArithmeticEncoder(bytes: number[]) {
  let a = 0x10000, c = 0, ct = 11, buffer = -1, pendingFF = 0, pendingZero = 0;
  const dcStats = [new Uint8Array(64), new Uint8Array(64)];
  const acStats = [new Uint8Array(256), new Uint8Array(256)];
  const context = new Uint8Array(4);
  const fixed = new Uint8Array([113]);
  const emit = (byte: number) => { bytes.push(byte); if (byte === 255) bytes.push(0); };
  const zeros = () => { while (pendingZero > 0) { bytes.push(0); pendingZero--; } };
  const flush = (carry: boolean) => {
    if (carry) {
      if (buffer >= 0) { zeros(); emit(buffer + 1); }
      pendingZero += pendingFF;
      pendingFF = 0;
    } else {
      if (buffer === 0) pendingZero++;
      else if (buffer >= 0) { zeros(); emit(buffer); }
      if (pendingFF > 0) {
        zeros();
        while (pendingFF > 0) { emit(255); pendingFF--; }
      }
    }
  };
  const bit = (stats: Uint8Array, index: number, value: number) => {
    const state = stats[index]!, packed = states[state & 127]!, qe = packed >>> 16;
    a -= qe;
    if (value !== state >>> 7) {
      if (a >= qe) { c += a; a = qe; }
      stats[index] = (state & 128) ^ (packed & 255);
    } else {
      if (a >= 0x8000) return;
      if (a < qe) { c += a; a = qe; }
      stats[index] = (state & 128) ^ ((packed >>> 8) & 255);
    }
    do {
      a *= 2; c *= 2;
      if (--ct === 0) {
        const byte = c >>> 19;
        if (byte === 255) pendingFF++;
        else { flush(byte > 255); buffer = byte & 255; }
        c &= 0x7ffff;
        ct = 8;
      }
    } while (a < 0x8000);
  };
  return {
    reset() {
      a = 0x10000; c = 0; ct = 11; buffer = -1; pendingFF = 0; pendingZero = 0;
      for (const stats of [...dcStats, ...acStats]) stats.fill(0);
      context.fill(0);
    },
    finish() {
      const end = ((a - 1 + c) & 0xffff0000) >>> 0;
      c = (end < c ? end + 0x8000 : end) * 2 ** ct;
      flush((c & 0xf8000000) !== 0);
      if ((c & 0x7fff800) !== 0) {
        zeros(); emit((c >>> 19) & 255);
        if ((c & 0x7f800) !== 0) emit((c >>> 11) & 255);
      }
    },
    block(zz: Int32Array, previousDc: number, component: number, dc: boolean, ac: boolean) {
      const table = component === 0 ? 0 : 1;
      if (dc) {
        const stats = dcStats[table]!;
        let index = context[component]!, value = zz[0]! - previousDc;
        bit(stats, index, value === 0 ? 0 : 1);
        if (value === 0) context[component] = 0;
        else {
          const negative = value < 0;
          bit(stats, index + 1, negative ? 1 : 0);
          index += negative ? 3 : 2;
          context[component] = negative ? 8 : 4;
          value = Math.abs(value) - 1;
          let magnitude = 0;
          if (value !== 0) {
            bit(stats, index, 1);
            magnitude = 1;
            index = 20;
            for (let remaining = value >>> 1; remaining; remaining >>>= 1) {
              bit(stats, index++, 1); magnitude *= 2;
            }
          }
          bit(stats, index, 0);
          if (magnitude > 1) context[component] += 8;
          index += 14;
          while ((magnitude >>>= 1) !== 0) bit(stats, index, (magnitude & value) ? 1 : 0);
        }
      }
      if (ac) {
        const stats = acStats[table]!;
        let end = 63;
        while (end > 0 && zz[end] === 0) end--;
        let k = 1;
        for (; k <= end; k++) {
          let index = 3 * (k - 1);
          bit(stats, index, 0);
          while (zz[k] === 0) { bit(stats, index + 1, 0); index += 3; k++; }
          bit(stats, index + 1, 1);
          bit(fixed, 0, zz[k]! < 0 ? 1 : 0);
          const value = Math.abs(zz[k]!) - 1;
          index += 2;
          let magnitude = 0;
          if (value !== 0) {
            bit(stats, index, 1); magnitude = 1;
            let remaining = value >>> 1;
            if (remaining !== 0) {
              bit(stats, index, 1); magnitude = 2;
              index = k <= 5 ? 189 : 217;
              while ((remaining >>>= 1) !== 0) { bit(stats, index++, 1); magnitude *= 2; }
            }
          }
          bit(stats, index, 0);
          index += 14;
          while ((magnitude >>>= 1) !== 0) bit(stats, index, (magnitude & value) ? 1 : 0);
        }
        if (k <= 63) bit(stats, 3 * (k - 1), 1);
      }
    }
  };
}
