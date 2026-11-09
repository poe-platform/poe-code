import { encodeAudio } from "@poe-code/media-codecs";
import { type MediaBudgetTracker, type MediaSample, type MediaTrack } from "./types.js";

export function encodeAmrTrack(track: MediaTrack, budget: MediaBudgetTracker, bitrate?: number, codec: "amr_nb" | "amr_wb" = "amr_nb"): MediaTrack {
  const audio = track.decodedAudio;
  const rate = codec === "amr_wb" ? 16000 : 8000;
  const frameSize = rate / 50;
  if (!audio || audio.sampleRate !== rate || audio.channels !== 1) {
    throw new Error(`AMR encoding requires mono ${rate} Hz PCM`);
  }
  const count = audio.channelData[0]?.length ?? 0;
  const packets = Math.ceil(count / frameSize) + (codec === "amr_nb" ? 1 : 0);
  budget.checkSamples(packets);
  budget.checkDuration(count / rate);
  budget.allocateMemory(packets * (61 + 128));
  budget.checkCpu();
  const encoded = encodeAudio(codec, rate, audio.channelData, bitrate ?? (codec === "amr_wb" ? 23850 : 12200));
  budget.checkCpu();
  const samples: MediaSample[] = encoded.packets.map((data, index) => {
    const pts = index * encoded.frameSize - encoded.delay;
    return { data, size: data.length, pts, dts: pts, cts: 0,
      duration: Math.min(encoded.frameSize, count - pts), isKeyframe: true,
      sampleDescriptionIndex: 1, ...(index === 0 ? { skipSamples: encoded.delay } : {}) };
  });
  return { ...track, timescale: rate, duration: count, samples, decodedAudio: undefined, editList: undefined,
    codecDescriptions: [{ formatFourCC: codec === "amr_wb" ? "sawb" : "samr", codecName: codec, sampleRate: rate,
      channels: 1, channelLayout: "mono", bitsPerSample: 16 }] };
}
