import type { MediaBudgetTracker } from "../types.js";

// Microsoft ADPCM predictors and adaptive quantizer multipliers.
export const msCoefficients = [[256, 0], [512, -256], [0, 0], [192, 64], [240, 0], [460, -208], [392, -232]] as const;
const adaptation = [230, 230, 230, 230, 307, 409, 512, 614, 768, 614, 512, 409, 307, 230, 230, 230];

export function msBlockFrames(size: number, channels: number): number {
  if (channels !== 1 && channels !== 2) throw new Error("MS ADPCM WAV requires mono or stereo audio");
  if (size < channels * 7) throw new Error("Invalid MS ADPCM WAV block size");
  return 2 + (size - channels * 7) * 2 / channels;
}

export function decodeMsWav(data: Uint8Array, channels: number, blockAlign: number, frames: number): Float32Array[] {
  const output = Array.from({ length: channels }, () => new Float32Array(frames));
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let frame = 0;
  for (let offset = 0; offset < data.length; offset += blockAlign) {
    const size = Math.min(blockAlign, data.length - offset);
    const count = msBlockFrames(size, channels);
    for (let ch = 0; ch < channels; ch++) {
      const coefficient = msCoefficients[data[offset + ch]!];
      if (!coefficient) throw new Error("Invalid MS ADPCM WAV predictor");
      let delta = view.getUint16(offset + channels + ch * 2, true);
      let recent = view.getInt16(offset + channels * 3 + ch * 2, true);
      let previous = view.getInt16(offset + channels * 5 + ch * 2, true);
      const samples = output[ch]!;
      samples[frame] = previous / 32768;
      samples[frame + 1] = recent / 32768;
      for (let i = 2; i < count; i++) {
        const nibbleIndex = (i - 2) * channels + ch;
        const byte = data[offset + channels * 7 + (nibbleIndex >>> 1)]!;
        const nibble = (nibbleIndex & 1) ? byte & 15 : byte >>> 4;
        const predicted = Math.trunc((recent * coefficient[0] + previous * coefficient[1]) / 256)
          + (nibble < 8 ? nibble : nibble - 16) * delta;
        previous = recent;
        recent = Math.max(-32768, Math.min(32767, predicted));
        delta = Math.max(16, Math.floor(delta * adaptation[nibble]! / 256));
        samples[frame + i] = recent / 32768;
      }
    }
    frame += count;
  }
  return output;
}

export function encodeMsWav(channelData: readonly (Float32Array | Float64Array)[], blockAlign: number, budget?: MediaBudgetTracker): Uint8Array {
  const channels = channelData.length;
  const frames = msBlockFrames(blockAlign, channels);
  const count = channelData[0]!.length;
  if (channelData.some(channel => channel.length !== count)) throw new Error("Unequal MS ADPCM channel lengths");
  const size = Math.ceil(count / frames) * blockAlign;
  budget?.checkOutputBytes(size);
  budget?.allocateMemory(size);
  const output = new Uint8Array(size);
  const view = new DataView(output.buffer);
  const deltas = new Int32Array(channels).fill(16);
  for (let frame = 0, offset = 0; offset < size; frame += frames, offset += blockAlign) {
    budget?.checkCpu();
    for (let ch = 0; ch < channels; ch++) {
      const samples = channelData[ch]!;
      let delta = deltas[ch]!;
      // FFmpeg selects predictor zero (the preceding sample) for every block.
      let recent = Math.max(-32768, Math.min(32767, Math.round((samples[frame + 1] ?? 0) * 32768)));
      const previous = Math.max(-32768, Math.min(32767, Math.round((samples[frame] ?? 0) * 32768)));
      view.setUint16(offset + channels + ch * 2, delta, true);
      view.setInt16(offset + channels * 3 + ch * 2, recent, true);
      view.setInt16(offset + channels * 5 + ch * 2, previous, true);
      for (let i = 2; i < frames; i++) {
        const target = Math.max(-32768, Math.min(32767, Math.round((samples[frame + i] ?? 0) * 32768)));
        const difference = target - recent;
        const bias = Math.trunc(delta / 2) * (difference < 0 ? -1 : 1);
        const quantized = Math.max(-8, Math.min(7, Math.trunc((difference + bias) / delta)));
        const nibble = quantized & 15;
        recent = Math.max(-32768, Math.min(32767, recent + quantized * delta));
        delta = Math.max(16, Math.floor(adaptation[nibble]! * delta / 256));
        const index = (i - 2) * channels + ch;
        output[offset + channels * 7 + (index >>> 1)]! |= nibble << ((index & 1) ? 0 : 4);
      }
      deltas[ch] = delta;
    }
  }
  return output;
}
