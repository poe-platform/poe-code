import { type MediaBudgetTracker } from "../types.js";
import { steps, indexChanges } from "./wav-ima.js";

export function encodeImaQt(channelData: readonly (Float32Array | Float64Array)[], budget?: MediaBudgetTracker): Uint8Array {
  const channels = channelData.length;
  if (channels < 1 || channels > 2) throw new Error("QuickTime IMA encoding supports mono or stereo audio");
  const frames = channelData[0]!.length;
  if (channelData.some(channel => channel.length !== frames)) throw new Error("Unequal QuickTime IMA channel lengths");
  const size = Math.ceil(frames / 64) * channels * 34;
  budget?.checkOutputBytes(size);
  budget?.allocateMemory(size);
  const output = new Uint8Array(size);
  const view = new DataView(output.buffer);
  const predictors = new Int16Array(channels), indices = new Uint8Array(channels);
  for (let frame = 0, offset = 0; frame < frames; frame += 64) {
    budget?.checkCpu();
    for (let channel = 0; channel < channels; channel++, offset += 34) {
      let predictor = predictors[channel]!, index = indices[channel]!;
      view.setInt16(offset, (predictor & ~127) | index);
      for (let sample = 0; sample < 64; sample++) {
        const target = Math.max(-32768, Math.min(32767, Math.round((channelData[channel]![frame + sample] ?? 0) * 32768)));
        let difference = target - predictor;
        let nibble = difference < 0 ? 8 : 0;
        difference = Math.abs(difference);
        const step = steps[index]!;
        let delta = step >> 3;
        for (let bit = 4, threshold = step; bit > 0; bit >>= 1, threshold >>= 1) {
          if (difference >= threshold) {
            nibble |= bit;
            difference -= threshold;
            delta += threshold;
          }
        }
        predictor = Math.max(-32768, Math.min(32767, predictor + ((nibble & 8) ? -delta : delta)));
        index = Math.max(0, Math.min(88, index + indexChanges[nibble & 7]!));
        output[offset + 2 + (sample >> 1)]! |= nibble << ((sample & 1) * 4);
      }
      predictors[channel] = predictor;
      indices[channel] = index;
    }
  }
  return output;
}
