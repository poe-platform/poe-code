import { type MediaBudgetTracker } from "../types.js";

// ITU-T G.722 inverse quantizers, logarithmic adaptation and synthesis QMF.
const lowQuantizer = [-17, -17, -17, -17, -3101, -2738, -2376, -2088,
  -1873, -1689, -1535, -1399, -1279, -1170, -1072, -982,
  -899, -822, -750, -682, -618, -558, -501, -447,
  -396, -347, -300, -254, -211, -170, -130, -91,
  3101, 2738, 2376, 2088, 1873, 1689, 1535, 1399,
  1279, 1170, 1072, 982, 899, 822, 750, 682,
  618, 558, 501, 447, 396, 347, 300, 254, 211, 170, 130, 91, 54, 17, -54, -17];
const adaptationQuantizer = [0, -2557, -1612, -1121, -786, -530, -323, -150,
  2557, 1612, 1121, 786, 530, 323, 150, 0];
const highQuantizer = [-926, -202, 926, 202];
const lowSteps = [-60, 3042, 1198, 538, 334, 172, 58, -30, 3042, 1198, 538, 334, 172, 58, -30, -60];
const inverseLog = [2048, 2093, 2139, 2186, 2233, 2282, 2332, 2383,
  2435, 2489, 2543, 2599, 2656, 2714, 2774, 2834,
  2896, 2960, 3025, 3091, 3158, 3228, 3298, 3371,
  3444, 3520, 3597, 3676, 3756, 3838, 3922, 4008];
const qmf = [3, -11, 12, 32, -210, 951, 3876, -805, 362, -156, 53, -11];
const clip = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

class Band {
  prediction = 0;
  zero = 0;
  log = 0;
  previous = 0;
  signs = [false, false];
  poles = [0, 0];
  differences = new Int32Array(6);
  coefficients = new Int32Array(6);
  constructor(public scale: number) {}

  update(delta: number, step: number, high: boolean) {
    const negative = this.zero + delta < 0;
    const sign = negative === this.signs[0] ? -1 : 1;
    this.poles[1] = clip(((sign * clip(this.poles[0]!, -8191, 8191)) >> 5)
      + (negative === this.signs[1] ? 128 : -128) + ((this.poles[1]! * 127) >> 7), -12288, 12288);
    const limit = 15360 - this.poles[1];
    this.poles[0] = clip(-192 * sign + ((this.poles[0]! * 255) >> 8), -limit, limit);
    this.signs[1] = this.signs[0]!;
    this.signs[0] = negative;
    this.zero = 0;
    for (let i = 5; i >= 0; i--) {
      this.coefficients[i] = ((this.coefficients[i]! * 255) >> 8)
        + (delta === 0 ? 0 : (this.differences[i]! ^ delta) < 0 ? -128 : 128);
      this.differences[i] = i === 0 ? delta * 2 : this.differences[i - 1]!;
      this.zero += (this.differences[i]! * this.coefficients[i]!) >> 15;
    }
    const reconstructed = clip((this.prediction + delta) * 2, -32768, 32767);
    this.prediction = clip(this.zero + ((this.poles[0] * reconstructed) >> 15)
      + ((this.poles[1] * this.previous) >> 15), -32768, 32767);
    this.previous = reconstructed;
    this.log = clip(((this.log * 127) >> 7) + step, 0, high ? 22528 : 18432);
    const exponent = this.log - ((high ? 10 : 8) << 11);
    const mantissa = inverseLog[(exponent >> 6) & 31]!;
    const shift = exponent >> 11;
    this.scale = shift < 0 ? mantissa >> -shift : mantissa << shift;
  }
}

export function decodeG722(data: Uint8Array, budget: MediaBudgetTracker): Float32Array {
  budget.allocateMemory(data.length * 2 * 4);
  const output = new Float32Array(data.length * 2);
  const low = new Band(8), high = new Band(2);
  const history = new Int16Array(24);
  for (let i = 0; i < data.length; i++) {
    if (i % 4096 === 0) budget.checkCpu();
    const code = data[i]!;
    const lowSample = clip(low.prediction + ((low.scale * lowQuantizer[code & 63]!) >> 10), -16384, 16383);
    const highDelta = (high.scale * highQuantizer[code >> 6]!) >> 10;
    const highSample = clip(high.prediction + highDelta, -16384, 16383);
    low.update((low.scale * adaptationQuantizer[(code & 63) >> 2]!) >> 10, lowSteps[(code & 63) >> 2]!, false);
    high.update(highDelta, code & 64 ? -214 : 798, true);
    history.copyWithin(0, 2);
    history[22] = lowSample + highSample;
    history[23] = lowSample - highSample;
    let even = 0, odd = 0;
    for (let tap = 0; tap < 12; tap++) {
      even += history[tap * 2 + 1]! * qmf[11 - tap]!;
      odd += history[tap * 2]! * qmf[tap]!;
    }
    output[i * 2] = clip(even >> 11, -32768, 32767) / 32768;
    output[i * 2 + 1] = clip(odd >> 11, -32768, 32767) / 32768;
  }
  return output;
}

// ITU-T G.722 low-band decision thresholds (Table 17).
const lowThresholds = [35, 72, 110, 150, 190, 233, 276, 323, 370, 422,
  473, 530, 587, 650, 714, 786, 858, 940, 1023, 1121, 1219, 1339,
  1458, 1612, 1765, 1980, 2195, 2557, 2919];

export function encodeG722(samples: Float32Array | Float64Array, budget: MediaBudgetTracker): Uint8Array {
  const length = Math.ceil(samples.length / 2);
  budget.checkOutputBytes(length);
  budget.allocateMemory(length);
  const output = new Uint8Array(length);
  const low = new Band(8), high = new Band(2);
  const history = new Int16Array(24);
  for (let i = 0; i < length; i++) {
    if (i % 4096 === 0) budget.checkCpu();
    history.copyWithin(0, 2);
    history[22] = clip(Math.round(samples[i * 2]! * 32768), -32768, 32767);
    // The last unpaired input sample is repeated, as in native FFmpeg.
    history[23] = clip(Math.round(samples[Math.min(i * 2 + 1, samples.length - 1)]! * 32768), -32768, 32767);
    let even = 0, odd = 0;
    for (let tap = 0; tap < 12; tap++) {
      even += history[tap * 2 + 1]! * qmf[11 - tap]!;
      odd += history[tap * 2]! * qmf[tap]!;
    }
    const lowDiff = clip(((even + odd) >> 14) - low.prediction, -32768, 32767);
    const highDiff = clip(((even - odd) >> 14) - high.prediction, -32768, 32767);
    const magnitude = ((lowDiff ^ (lowDiff >> 31)) + 1) * 1024;
    let index = 0;
    while (index < lowThresholds.length && magnitude > lowThresholds[index]! * low.scale) index++;
    const lowCode = (lowDiff < 0 ? (index < 2 ? 63 : 33) : 61) - index;
    const highCode = Number((highDiff ^ (highDiff >> 31)) < ((141 * high.scale) >> 8)) + (highDiff >= 0 ? 2 : 0);
    low.update((low.scale * adaptationQuantizer[lowCode >> 2]!) >> 10, lowSteps[lowCode >> 2]!, false);
    high.update((high.scale * highQuantizer[highCode]!) >> 10, highCode & 1 ? -214 : 798, true);
    output[i] = (highCode << 6) | lowCode;
  }
  return output;
}
