import { decodeAudio } from "@poe-code/media-codecs";
import type { MediaAudioData, MediaBudgetTracker, MediaSample } from "./types.js";

// Octet-aligned AMR-NB frame sizes, including the TOC byte (3GPP TS 26.101).
const frameBytes = [13, 14, 16, 18, 20, 21, 27, 32, 6];

export function decodeAmrNb(samples: readonly MediaSample[], budget: MediaBudgetTracker): MediaAudioData {
  function* packets() {
    let pts = 0;
    for (const sample of samples) {
      for (let offset = 0; offset < sample.data.length;) {
        budget.checkCpu();
        const header = sample.data[offset]!;
        const size = frameBytes[(header >> 3) & 15];
        if ((header & 0x83) || !size || offset + size > sample.data.length) {
          throw new Error("Invalid or unsupported AMR-NB frame");
        }
        yield { data: sample.data.subarray(offset, offset + size), pts, dts: pts, duration: 160 };
        offset += size;
        pts += 160;
      }
    }
  }
  let count = 0;
  for (const packet of packets()) count += packet.duration;
  budget.allocateMemory(count * 4);
  const pcm = new Float32Array(count);
  let offset = 0;
  for (const frame of decodeAudio("AMR-NB", packets())) {
    budget.checkCpu();
    if (frame.sampleRate !== 8000 || frame.channelData.length !== 1 || frame.channelData[0]!.length !== 160) {
      throw new Error("Invalid AMR-NB decoded dimensions");
    }
    pcm.set(frame.channelData[0]!, offset);
    offset += 160;
  }
  return { sampleRate: 8000, channels: 1, channelData: [pcm] };
}
