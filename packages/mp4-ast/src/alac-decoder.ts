import { BitReader } from "./binary.js";
import type { MediaAudioData, MediaBudgetTracker, MediaSample } from "./types.js";

/** Decode ALAC single-channel and channel-pair elements, including Rice/LPC frames. */
export function decodeAlac(samples: readonly MediaSample[], config: Uint8Array, budget: MediaBudgetTracker): MediaAudioData {
  const view = new DataView(config.buffer, config.byteOffset, config.byteLength);
  const frameLength = view.getUint32(0), bits = config[5]!, channels = config[9]!;
  const sampleRate = view.getUint32(20);
  if (![16, 20, 24, 32].includes(bits) || channels < 1 || channels > 2 || !frameLength || !sampleRate) {
    throw new Error("Unsupported ALAC configuration");
  }
  const count = samples.reduce((sum, sample) => sum + sample.duration, 0);
  budget.allocateMemory(count * channels * 8);
  const channelData = Array.from({ length: channels }, () => new Float64Array(count));
  let outputOffset = 0;
  const signed = (value: number, width: number) => value << (32 - width) >> (32 - width);
  for (const sample of samples) {
    budget.checkCpu();
    const reader = new BitReader(sample.data);
    const read = (width: number) => {
      if (width < 0 || width > 32 || reader.bitsRemaining < width) throw new Error("Truncated ALAC packet");
      return reader.readBits(width);
    };
    const element = read(3);
    if (element !== channels - 1) throw new Error("Unsupported ALAC channel element");
    read(16);
    const hasSize = read(1);
    let lowBits = read(2) * 8;
    const verbatim = read(1);
    const frames = hasSize ? read(32) : frameLength;
    if (!frames || frames > frameLength || frames !== sample.duration) throw new Error("Invalid ALAC frame length");
    const width = bits - lowBits + channels - 1;
    if (!verbatim && (width < 1 || width > 32)) throw new Error("Invalid ALAC sample width");
    budget.allocateMemory(frames * channels * 8);
    const values = Array.from({ length: channels }, () => new Int32Array(frames));
    const lows = Array.from({ length: channels }, () => new Uint32Array(frames));
    let shift = 0, weight = 0;
    if (verbatim) {
      lowBits = 0;
      for (let i = 0; i < frames; i++) for (let ch = 0; ch < channels; ch++) values[ch]![i] = signed(read(bits), bits);
    } else {
      shift = read(8); weight = read(8);
      if (shift > 31 || !config[8] || config[8]! > 31) throw new Error("Invalid ALAC Rice configuration");
      const predictors = Array.from({ length: channels }, () => {
        const type = read(4), quant = read(4), multiplier = read(3), order = read(5);
        if ((type !== 0 && type !== 15) || !quant || order >= frameLength) throw new Error("Unsupported ALAC predictor");
        const coefficients = Array.from({ length: order }, () => signed(read(16), 16)).reverse();
        return { type, quant, multiplier, order, coefficients };
      });
      for (let i = 0; i < frames; i++) for (let ch = 0; ch < channels; ch++) lows[ch]![i] = read(lowBits);
      const scalar = (k: number, escapeBits: number) => {
        let prefix = 0;
        while (prefix < 9 && read(1)) prefix++;
        if (prefix === 9) return read(escapeBits);
        if (k === 1) return prefix;
        const extra = read(k);
        if (extra <= 1) reader.bitOffset--;
        return prefix * (2 ** k - 1) + (extra > 1 ? extra - 1 : 0);
      };
      for (let ch = 0; ch < channels; ch++) {
        const predictor = predictors[ch]!, data = values[ch]!;
        let history = config[7]!, modifier = 0;
        const multiplier = Math.floor(predictor.multiplier * config[6]! / 4);
        for (let i = 0; i < frames; i++) {
          if (i % 1024 === 0) budget.checkCpu();
          const k = Math.min(Math.floor(Math.log2((history >>> 9) + 3)), config[8]!);
          const value = scalar(k, width) + modifier;
          data[i] = (value >>> 1) ^ -(value & 1);
          modifier = 0;
          history = value > 65535 ? 65535 : history + value * multiplier - ((history * multiplier) >>> 9);
          if (history < 128 && i + 1 < frames) {
            const runK = Math.min(7 - (history ? Math.floor(Math.log2(history)) : 0) + ((history + 16) >> 6), config[8]!);
            const run = scalar(runK, 16);
            if (run >= frames - i) throw new Error("Invalid ALAC zero run");
            i += run;
            modifier = run <= 65535 ? 1 : 0;
            history = 0;
          }
        }
        if (predictor.type === 15) for (let i = 1; i < frames; i++) data[i] = signed(data[i]! + data[i - 1]!, width);
        const { order, quant, coefficients } = predictor;
        if (order === 31) {
          for (let i = 1; i < frames; i++) data[i] = signed(data[i]! + data[i - 1]!, width);
        } else if (order) {
          for (let i = 1; i <= order && i < frames; i++) data[i] = signed(data[i]! + data[i - 1]!, width);
          for (let i = order + 1; i < frames; i++) {
            if (i % 1024 === 0) budget.checkCpu();
            const base = data[i - order - 1]!;
            let prediction = 0, error = data[i]!;
            for (let j = 0; j < order; j++) prediction = (prediction + (data[i - order + j]! - base) * coefficients[j]!) | 0;
            data[i] = signed(Math.floor((prediction + 2 ** (quant - 1)) / 2 ** quant) + base + error, width);
            const direction = Math.sign(error);
            for (let j = 0; j < order && error * direction > 0; j++) {
              const delta = base - data[i - order + j]!;
              const adjustment = Math.sign(delta) * direction;
              coefficients[j] = signed(coefficients[j]! - adjustment, 16);
              error -= (delta * adjustment >> quant) * (j + 1);
            }
          }
        }
      }
    }
    if (read(3) !== 7) throw new Error("Missing ALAC end element");
    for (let i = 0; i < frames; i++) {
      if (channels === 2 && weight) {
        const difference = values[1]![i]!;
        const right = values[0]![i]! - Math.floor(difference * weight / 2 ** shift);
        values[0]![i] = right + difference;
        values[1]![i] = right;
      }
      for (let ch = 0; ch < channels; ch++) {
        channelData[ch]![outputOffset + i] = signed(values[ch]![i]! * 2 ** lowBits + lows[ch]![i]!, bits) / 2 ** (bits - 1);
      }
    }
    outputOffset += frames;
    budget.releaseMemory(frames * channels * 8);
  }
  return { sampleRate, channels, channelData };
}
