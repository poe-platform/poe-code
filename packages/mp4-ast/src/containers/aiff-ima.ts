import { type MediaBudgetTracker, type MediaDocument, type MediaSample, type ParseMediaOptions } from "../types.js";
import { steps, indexChanges } from "./wav-ima.js";

export function parseImaQt(data: Uint8Array, channels: number, sampleRate: number, blocks: number,
  options: ParseMediaOptions, budget: MediaBudgetTracker): MediaDocument {
  const blockSize = 34 * channels;
  if (data.length % blockSize) throw new Error("Truncated QuickTime IMA packet");
  const count = data.length / blockSize;
  const duration = blocks * 64;
  budget.checkStreams(1);
  budget.checkSamples(count);
  budget.checkDuration(Math.max(duration, count * 64) / sampleRate);
  let channelData: Float32Array[] | undefined;
  if (options.decodeAudio !== false) {
    budget.allocateMemory(count * 64 * channels * 4);
    channelData = Array.from({ length: channels }, () => new Float32Array(count * 64));
  }
  const predictors = new Int16Array(channels), indices = new Uint8Array(channels);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const samples: MediaSample[] = [];
  for (let block = 0; block < count; block++) {
    budget.checkCpu();
    const packet = data.subarray(block * blockSize, (block + 1) * blockSize);
    samples.push({ data: packet, size: blockSize, dts: block * 64, pts: block * 64, cts: 0,
      duration: 64, isKeyframe: true, sampleDescriptionIndex: 1 });
    for (let channel = 0; channel < channels; channel++) {
      const offset = block * blockSize + channel * 34;
      const header = view.getInt16(offset);
      let index = header & 127;
      if (index > 88) throw new Error("Invalid QuickTime IMA step index");
      if (!channelData) continue;
      let predictor = header & ~127;
      // Preserve the preceding packet's low predictor bits when its state matches.
      if (indices[channel] === index && Math.abs(predictor - predictors[channel]!) <= 127) predictor = predictors[channel]!;
      for (let sample = 0; sample < 64; sample++) {
        const nibble = data[offset + 2 + (sample >> 1)]! >> ((sample & 1) * 4) & 15;
        const step = steps[index]!;
        const delta = (step >> 3) + ((nibble & 1) ? step >> 2 : 0)
          + ((nibble & 2) ? step >> 1 : 0) + ((nibble & 4) ? step : 0);
        predictor = Math.max(-32768, Math.min(32767, predictor + ((nibble & 8) ? -delta : delta)));
        index = Math.max(0, Math.min(88, index + indexChanges[nibble & 7]!));
        channelData[channel]![block * 64 + sample] = predictor / 32768;
      }
      predictors[channel] = predictor;
      indices[channel] = index;
    }
  }
  return {
    containerFormat: "aiff", timescale: sampleRate, duration, durationSeconds: duration / sampleRate,
    metadata: {}, byteLength: data.length,
    tracks: [{ id: 1, type: "audio", handlerType: "soun", timescale: sampleRate, duration, language: "und", enabled: true,
      codecDescriptions: [{ formatFourCC: "ima4", codecName: "adpcm_ima_qt", sampleRate, channels, bitsPerSample: 4 }],
      samples, ...(channelData ? { decodedAudio: { sampleRate, channels, channelData } } : {}) }]
  };
}
