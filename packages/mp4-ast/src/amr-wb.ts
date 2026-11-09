import { decodeAudio } from "@poe-code/media-codecs";
import type { MediaAudioData, MediaBudgetTracker, MediaSample } from "./types.js";

/** Decode 3GP AMR-WB access units to mono 16 kHz PCM. */
export function decodeAmrWb(samples: readonly MediaSample[], budget: MediaBudgetTracker): MediaAudioData {
  const frames: Float32Array[] = [];
  let count = 0;
  for (const frame of decodeAudio("AMR-WB", samples)) {
    budget.checkCpu();
    if (frame.sampleRate !== 16000 || frame.channelData.length !== 1 || frame.channelData[0]!.length !== 320) {
      throw new Error("Invalid AMR-WB decoded dimensions");
    }
    const data = frame.channelData[0]!;
    count += data.length;
    if (count * 4 > 128 * 1024 * 1024) throw new Error("AMR-WB PCM exceeds size limit");
    budget.checkDuration(count / 16000);
    budget.allocateMemory(data.byteLength);
    frames.push(data);
  }
  budget.allocateMemory(count * 4);
  const pcm = new Float32Array(count);
  let offset = 0;
  for (const frame of frames) {
    pcm.set(frame, offset);
    offset += frame.length;
  }
  budget.releaseMemory(count * 4);
  return { sampleRate: 16000, channels: 1, channelData: [pcm] };
}
