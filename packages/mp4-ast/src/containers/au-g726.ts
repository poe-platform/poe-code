/*
 * This source code is a product of Sun Microsystems, Inc. and is provided
 * for unrestricted use.  Users may copy or modify this source code without
 * charge.
 *
 * SUN SOURCE CODE IS PROVIDED AS IS WITH NO WARRANTIES OF ANY KIND INCLUDING
 * THE WARRANTIES OF DESIGN, MERCHANTIBILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE, OR ARISING FROM A COURSE OF DEALING, USAGE OR TRADE PRACTICE.
 *
 * Sun source code is provided with no support and without any obligation on
 * the part of Sun Microsystems, Inc. to assist in its use, correction,
 * modification or enhancement.
 *
 * SUN MICROSYSTEMS, INC. SHALL HAVE NO LIABILITY WITH RESPECT TO THE
 * INFRINGEMENT OF COPYRIGHTS, TRADE SECRETS OR ANY PATENTS BY THIS SOFTWARE
 * OR ANY PART THEREOF.
 *
 * In no event will Sun Microsystems, Inc. be liable for any lost revenue
 * or profits or other special, indirect and consequential damages, even if
 * Sun has been advised of the possibility of such damages.
 *
 * Sun Microsystems, Inc.
 * 2550 Garcia Avenue
 * Mountain View, California  94043
 */
// G.721/G.723 predictor arithmetic and tables (G.726, 16/24/32/40 kbit/s).
import { type MediaBudgetTracker } from "../types.js";

const tables = {
  2: { inverse: [116, 365, 365, 116], scale: [-22, 439, 439, -22], speed: [0, 7, 7, 0] },
  3: {
    inverse: [-32768, 135, 273, 373, 373, 273, 135, -32768],
    scale: [-4, 30, 137, 582, 582, 137, 30, -4],
    speed: [0, 1, 2, 7, 7, 2, 1, 0]
  },
  4: {
    inverse: [-32768, 4, 135, 213, 273, 323, 373, 425, 425, 373, 323, 273, 213, 135, 4, -32768],
    scale: [-12, 18, 41, 64, 112, 198, 355, 1122, 1122, 355, 198, 112, 64, 41, 18, -12],
    speed: [0, 0, 0, 1, 1, 1, 3, 7, 7, 3, 1, 1, 1, 0, 0, 0]
  },
  5: {
    inverse: [-32768, -66, 28, 104, 169, 224, 274, 318, 358, 395, 429, 459, 488, 514, 539, 566,
      566, 539, 514, 488, 459, 429, 395, 358, 318, 274, 224, 169, 104, 28, -66, -32768],
    scale: [14, 14, 24, 39, 40, 41, 58, 100, 141, 179, 219, 280, 358, 440, 529, 696,
      696, 529, 440, 358, 280, 219, 179, 141, 100, 58, 41, 40, 39, 24, 14, 14],
    speed: [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 3, 4, 5, 6, 6,
      6, 6, 5, 4, 3, 2, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0]
  }
};

// Keep five exponent bits: abs(-32768) needs exponent 16 without overlapping the sign.
function floating(value: number): number {
  const magnitude = Math.abs(value);
  const exponent = magnitude ? 32 - Math.clz32(magnitude) : 0;
  return (value < 0 ? 2048 : 0) | exponent << 6 | (magnitude ? (magnitude << 6) >> exponent : 32);
}

function multiply(coefficient: number, history: number): number {
  const packed = floating(coefficient);
  const exponent = ((packed >> 6) & 31) + ((history >> 6) & 31) - 19;
  const mantissa = (((packed & 63) * (history & 63)) + 48) >> 4;
  const magnitude = exponent >= 0 ? mantissa << exponent : mantissa >> -exponent;
  return ((packed ^ history) & 2048 ? -magnitude : magnitude) << 16 >> 16;
}

export function decodeG726(data: Uint8Array, bits: 2 | 3 | 4 | 5, budget: MediaBudgetTracker, littleEndian: boolean): Float64Array {
  const duration = Math.floor(data.length * 8 / bits);
  budget.allocateMemory(duration * 8);
  const output = new Float64Array(duration);
  const { inverse, scale, speed } = tables[bits];
  const poles = [0, 0], zeros = [0, 0, 0, 0, 0, 0];
  const signals = [32, 32], differences = [32, 32, 32, 32, 32, 32];
  const signs = [1, 1];
  let slowScale = 34816, step = 544, adaptation = 0, shortEnergy = 0, longEnergy = 0;
  let estimate = 0, zeroEstimate = 0, tone = false;
  for (let frame = 0; frame < duration; frame++) {
    if (frame % 4096 === 0) budget.checkCpu();
    const bit = frame * bits, byte = Math.floor(bit / 8);
    const code = (littleEndian
      ? (data[byte]! | (data[byte + 1] ?? 0) << 8) >> (bit % 8)
      : (data[byte]! << 8 | (data[byte + 1] ?? 0)) >> (16 - bits - bit % 8)) & ((1 << bits) - 1);
    const negative = code >> (bits - 1);
    const logarithm = inverse[code]! + (step >> 2);
    const magnitude = logarithm < 0 ? 0 : ((128 + (logarithm & 127)) << ((logarithm >> 7) & 15)) >> 7;
    const threshold = slowScale >> 15 > 9 ? 31 << 10 : (32 + ((slowScale >> 10) & 31)) << (slowScale >> 15);
    const transition = tone && magnitude > ((3 * threshold) >> 2);
    const difference = negative ? -magnitude : magnitude;
    const signal = (estimate + difference) << 16 >> 16;
    const sign = Math.sign(zeroEstimate + difference);
    if (transition) {
      poles.fill(0);
      zeros.fill(0);
    } else {
      const correction = Math.max(-256, Math.min(255, (-poles[0]! * signs[0]! * sign) >> 5));
      poles[1] = Math.max(-12288, Math.min(12288,
        poles[1]! + 128 * sign * signs[1]! + correction - (poles[1]! >> 7)));
      const limit = 15360 - poles[1]!;
      poles[0] = Math.max(-limit, Math.min(limit, poles[0]! + 192 * sign * signs[0]! - (poles[0]! >> 8)));
      for (let i = 0; i < 6; i++) {
        zeros[i] = zeros[i]! + 128 * Math.sign(difference) * (differences[i]! & 2048 ? -1 : 1) - (zeros[i]! >> 8);
      }
    }
    signs[1] = signs[0]!;
    signs[0] = sign || 1;
    signals[1] = signals[0]!;
    signals[0] = floating(signal);
    for (let i = 5; i > 0; i--) differences[i] = differences[i - 1]!;
    differences[0] = (floating(difference) & 2047) | negative << 11;
    tone = poles[1]! < -11776;
    shortEnergy += (speed[code]! << 4) + (-shortEnergy >> 5);
    longEnergy += (speed[code]! << 4) + (-longEnergy >> 7);
    adaptation = transition ? 256 : adaptation + (-adaptation >> 4) +
      (step <= 1535 || tone || Math.abs((shortEnergy << 2) - longEnergy) >= (longEnergy >> 3) ? 32 : 0);
    const fastScale = Math.max(544, Math.min(5120, step + scale[code]! + (-step >> 5)));
    slowScale += fastScale + (-slowScale >> 6);
    step = (slowScale + (fastScale - (slowScale >> 6)) * (adaptation >= 256 ? 64 : adaptation >> 2)) >> 6;
    estimate = zeros.reduce((sum, value, i) => sum + multiply(value >> 2, differences[i]!), 0);
    zeroEstimate = estimate >> 1;
    estimate = (estimate + poles.reduce((sum, value, i) => sum + multiply(value >> 2, signals[i]!), 0)) >> 1;
    // Native G.726 returns a signed 16-bit sample after its output limiter.
    output[frame] = (Math.max(-65535, Math.min(65535, signal * 4)) << 16 >> 16) / 32768;
  }
  return output;
}
