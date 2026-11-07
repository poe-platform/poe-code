import { decodeAudio, encodeAudio } from "@poe-code/media-codecs";
import { writeMp3Frames } from "./containers/mp3-frames.js";
import type { MediaAudioData, MediaTrack } from "./types.js";

export function decodeMp3Track(track: MediaTrack): MediaAudioData {
  const { sampleRate, channels } = track.codecDescriptions[0]!;
  if (!sampleRate || !channels || channels > 2) throw new Error("Unsupported MP3 PCM dimensions");
  const lengths = track.samples.map(sample => {
    const length = Math.round(sample.duration / track.timescale * sampleRate);
    const skip = sample.skipSamples ?? 0;
    const padding = sample.discardPadding ?? 0;
    if (![length, skip, padding].every(Number.isSafeInteger) || skip < 0 || padding < 0 || skip + padding > length) {
      throw new Error("Invalid MP3 sample trimming");
    }
    return length - skip - padding;
  });
  const count = lengths.reduce((total, length) => total + length, 0);
  if (!Number.isSafeInteger(count) || count * channels * 4 > 128 * 1024 * 1024) {
    throw new Error("Unsupported MP3 PCM dimensions");
  }
  const channelData = Array.from({ length: channels }, () => new Float32Array(count));
  let index = 0, offset = 0;
  for (const frame of decodeAudio("MP3", track.samples)) {
    const sample = track.samples[index];
    if (!sample || frame.sampleRate !== sampleRate || frame.channelData.length !== channels ||
        frame.pts !== sample.pts || frame.channelData[0]!.length !== Math.round(sample.duration / track.timescale * sampleRate)) {
      throw new Error("MP3 decoded frame differs from packet dimensions or timing");
    }
    const length = lengths[index++]!;
    const skip = sample.skipSamples ?? 0;
    for (let channel = 0; channel < channels; channel++) {
      channelData[channel]!.set(frame.channelData[channel]!.subarray(skip, skip + length), offset);
    }
    offset += length;
  }
  if (offset !== count) throw new Error("Incomplete MP3 PCM output");
  return { sampleRate, channels, channelData };
}

/** Include the encoder delay and end padding so readers recover the PCM duration. */
export function encodeMp3(audio: MediaAudioData): Uint8Array {
  const { packets, frameSize, delay } = encodeAudio("mp3", audio.sampleRate, audio.channelData);
  return writeMp3Frames(packets.map((data, index) => ({
    data,
    skipSamples: index === 0 ? delay : 0,
    discardPadding: index === packets.length - 1 ? packets.length * frameSize - audio.channelData[0]!.length - delay : 0
  })));
}
