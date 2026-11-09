import type { MediaBudgetTracker, MediaSample, MediaTrack } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { resampleAudio } from "./audio-resample.js";

export async function resampleStreamselectInput(
  track: MediaTrack, sampleRate: number, budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<MediaTrack> {
  const audio = track.decodedAudio!;
  const length = audio.channelData[0]!.length;
  const ratio = audio.sampleRate / sampleRate;
  const outputLength = Math.ceil(length / ratio);
  budget.checkSamples(outputLength);
  budget.checkDuration(outputLength / sampleRate);
  budget.allocateMemory(outputLength * audio.channels * Float32Array.BYTES_PER_ELEMENT);
  const channelData = await resampleAudio(audio.channelData, outputLength, audio.sampleRate, sampleRate, budget, signal);
  const resampledLength = channelData[0]!.length;
  const samples: MediaSample[] = [];
  const offset = Math.round((track.samples[0]?.pts ?? 0) * sampleRate / track.timescale);
  let emitted = 0;
  function appendFrame(end: number): void {
    if (end <= emitted) return;
    budget.allocateMemory(96);
    samples.push({ data: new Uint8Array(0), size: 0, pts: offset + emitted, dts: offset + emitted,
      cts: 0, duration: end - emitted, isKeyframe: true, sampleDescriptionIndex: 1 });
    emitted = end;
  }
  // SWR's default 32-tap filter holds half its support until more input
  // arrives. Keep those packet boundaries, including the separate EOF flush,
  // so framesync can stop without forwarding an unavailable tail frame.
  const filterLength = 2 * Math.ceil(16 / Math.min(0.97 / ratio, 1));
  for (let consumed = 0, index = 0; consumed < length; index++) {
    if (index % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
    const packet = track.samples[index];
    const count = packet ? Math.max(0, Math.round(packet.duration * audio.sampleRate / track.timescale)
      - (packet.skipSamples ?? 0) - (packet.discardPadding ?? 0)) : 1024;
    consumed = Math.min(length, consumed + count);
    if (consumed > filterLength) {
      appendFrame(Math.min(resampledLength, Math.ceil((consumed - filterLength / 2) / ratio)));
    }
  }
  appendFrame(resampledLength);
  return { ...track, timescale: sampleRate, duration: resampledLength, samples, editList: undefined,
    decodedAudio: { ...audio, sampleRate, channelData } };
}
