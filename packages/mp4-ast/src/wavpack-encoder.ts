import { sampleRates } from "./containers/wavpack.js";
import type { MediaBudgetTracker, MediaSample, MediaTrack } from "./types.js";

export function encodeWavpackTrack(track: MediaTrack, budget: MediaBudgetTracker): MediaTrack {
  const audio = track.decodedAudio;
  if (!audio) throw new Error("WavPack encoding requires decoded audio");
  const { channels, sampleRate, channelData } = audio;
  if (channels !== 1 && channels !== 2) throw new Error("WavPack encoding supports mono and stereo audio");
  const sourceBits = track.codecDescriptions[0]?.bitsPerSample ?? 16;
  if (sourceBits > 24) throw new Error("WavPack encoding supports integer PCM up to 24 bits");
  const bits = sourceBits > 16 ? 24 : 16;
  const frames = channelData[0]?.length ?? 0;
  if (channelData.length !== channels || channelData.some(channel => channel.length !== frames)) throw new Error("Invalid WavPack audio channels");
  if (!Number.isInteger(sampleRate) || sampleRate < 1 || sampleRate > 0xffffff) throw new Error("Invalid WavPack sample rate");
  budget.checkDuration(frames / sampleRate);
  budget.checkSamples(Math.ceil(frames / 256));
  const rateIndex = sampleRates.indexOf(sampleRate);
  const scale = 2 ** (bits - 1);
  const samples: MediaSample[] = [];
  const startPts = Math.round((track.samples[0]?.pts ?? 0) * sampleRate / track.timescale);
  let outputBytes = 0;
  for (let start = 0; start < frames; start += 256) {
    budget.checkCpu();
    const count = Math.min(256, frames - start);
    // Short independent blocks bound memory. Initial entropy medians stay above
    // the zero-run threshold throughout the block, including for silent input.
    const capacity = 64 + Math.ceil(count * channels * (bits + 80) / 8);
    budget.allocateMemory(capacity);
    const buffer = new Uint8Array(capacity);
    const view = new DataView(buffer.buffer);
    buffer.set([0x77, 0x76, 0x70, 0x6b]);
    view.setUint16(8, 0x410, true);
    view.setUint32(12, frames, true);
    view.setUint32(16, start, true);
    view.setUint32(20, count, true);
    // Identity decorrelation (zero weight and delta), with no joint stereo.
    view.setUint32(24, (bits / 8 - 1) | (channels === 1 ? 4 : 0) | 0x1800 |
      ((bits - 1) << 18) | ((rateIndex < 0 ? 15 : rateIndex) << 23), true);
    let offset = 32;
    buffer.set([0x42, 1, 6, 0, 3, 0, 4, 0, 5, channels * 3], offset);
    offset += 10;
    for (let i = 0; i < channels * 3; i++) view.setUint16(offset + i * 2, (bits + 4) * 256, true);
    offset += channels * 6;
    if (rateIndex < 0) {
      buffer.set([0x67, 2, sampleRate & 255, (sampleRate >>> 8) & 255, sampleRate >>> 16, 0], offset);
      offset += 6;
    }
    const streamHeader = offset;
    buffer[offset] = 0x8a; // large WV bitstream metadata, measured in 16-bit words
    offset += 4;
    let bit = offset * 8;
    const write = (value: number, width: number): void => {
      for (let j = 0; j < width; j++, bit++) buffer[bit >>> 3]! |= ((value >>> j) & 1) << (bit & 7);
    };
    const unary = (value: number): void => { for (let j = 0; j < value; j++) write(1, 1); write(0, 1); };
    const gamma = (value: number): void => {
      const width = value ? Math.floor(Math.log2(value)) + 1 : 0;
      unary(width);
      if (width > 1) write(value - 2 ** (width - 1), width - 1);
    };
    const medians = Array.from({ length: channels }, () => [2 ** (bits + 3), 2 ** (bits + 3), 2 ** (bits + 3)]);
    let crc = 0xffffffff;
    const word = (index: number) => {
      const ch = index % channels;
      const value = Math.max(-scale, Math.min(scale - 1, Math.round(channelData[ch]![start + Math.floor(index / channels)]! * scale)));
      crc = (Math.imul(crc, 3) + value) >>> 0;
      const magnitude = value < 0 ? ~value : value;
      const median = medians[ch]!;
      let low = 0, high = 0, ones = 0;
      for (let j = 0; j < 3; j++) {
        const width = Math.floor(median[j]! / 16) + 1, divisor = 128 >>> j;
        if (magnitude < low + width) {
          high = low + width - 1;
          median[j]! -= Math.floor((median[j]! + divisor - 2) / divisor) * 2;
          break;
        }
        const steps = j === 2 ? Math.floor((magnitude - low) / width) : 1;
        ones += steps;
        low += width * steps;
        high = low + width - 1;
        median[j]! += Math.floor((median[j]! + divisor) / divisor) * 5;
      }
      return { ones, code: magnitude - low, max: high - low, sign: value < 0 ? 1 : 0 };
    };
    let current = word(0), holdingOne = 0, holdingZero = false;
    for (let i = 0; i < count * channels; i++) {
      const next = i + 1 < count * channels ? word(i + 1) : undefined;
      if (holdingZero) holdingZero = false;
      else {
        const nextOne = next && next.ones > 0 ? 1 : 0;
        const ones = 2 * (current.ones - holdingOne) + nextOne;
        unary(Math.min(16, ones));
        if (ones >= 16) gamma(ones - 16);
        holdingOne = nextOne;
        holdingZero = !nextOne;
      }
      const width = current.max ? Math.floor(Math.log2(current.max)) + 1 : 0;
      const extras = 2 ** width - current.max - 1;
      if (width) {
        if (current.code < extras) write(current.code, width - 1);
        else {
          write(Math.floor((current.code + extras) / 2), width - 1);
          write((current.code + extras) & 1, 1);
        }
      }
      write(current.sign, 1);
      if (next) current = next;
    }
    while (bit % 16) write(1, 1);
    const length = bit / 8;
    const words = (length - offset) / 2;
    buffer[streamHeader + 1] = words & 255;
    buffer[streamHeader + 2] = (words >>> 8) & 255;
    buffer[streamHeader + 3] = words >>> 16;
    view.setUint32(4, length - 8, true);
    view.setUint32(28, crc, true);
    outputBytes += length;
    budget.checkOutputBytes(outputBytes);
    budget.allocateMemory(length);
    const data = buffer.slice(0, length);
    budget.releaseMemory(capacity);
    samples.push({ data, dts: startPts + start, pts: startPts + start, cts: 0, duration: count,
      size: length, isKeyframe: true, sampleDescriptionIndex: 1 });
  }
  return { ...track, samples, timescale: sampleRate, duration: frames, decodedAudio: undefined,
    codecDescriptions: [{ codecName: "wavpack", formatFourCC: "wvpk", sampleRate, channels, bitsPerSample: bits,
      extraData: Uint8Array.of(0x10, 0x04) }] };
}
