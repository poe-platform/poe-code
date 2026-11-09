import { readOgg } from "@poe-code/audio-ast";
import { decodeAudio } from "@poe-code/media-codecs";
import { concatBytes } from "./binary.js";
import type { MediaAudioData, MediaSample, MediaTrack } from "./types.js";

function readVorbisTrack(track: MediaTrack) {
  const { packets } = readOgg(concatBytes(track.samples.map(sample => sample.data)));
  const [identification, comments, setup] = packets;
  if (!identification || !comments || !setup || identification.data[0] !== 1 ||
      comments.data[0] !== 3 || setup.data[0] !== 5 ||
      packets.some(packet => packet.serial !== identification.serial)) {
    throw new Error("Unsupported Vorbis headers or logical streams");
  }
  const lacing = [2];
  for (const header of [identification, comments]) {
    let length = header.data.length;
    while (length >= 255) { lacing.push(255); length -= 255; }
    lacing.push(length);
  }
  const extra = concatBytes([Uint8Array.from(lacing), identification.data, comments.data, setup.data]);
  return { packets, extra };
}

/** Decode overlap windows before applying Ogg page granules and final padding. */
export function* decodeVorbisFrames(track: MediaTrack) {
  const { packets, extra } = readVorbisTrack(track);
  const { sampleRate, channels } = track.codecDescriptions[0]!;
  let count = 0;
  // The first packet primes the overlap window and produces no PCM.
  let position: number | undefined;
  let index = 4;
  for (const frame of decodeAudio("Vorbis", packets.slice(3).map(packet => ({
    data: packet.data, pts: 0, dts: 0, duration: 0
  })), extra)) {
    if (frame.sampleRate !== sampleRate || frame.channelData.length !== channels) {
      throw new Error("Vorbis decoded dimensions differ from sample description");
    }
    const packet = packets[index++]!;
    let length = frame.channelData[0]!.length;
    position ??= packets[3]!.granule !== 0xffffffffffffffffn
      ? Number(packets[3]!.granule) : frame.pts;
    const pts = position;
    position += length;
    if (packet.granule !== 0xffffffffffffffffn) {
      const granule = Number(packet.granule);
      if (!Number.isSafeInteger(granule)) throw new Error("Invalid Vorbis granule");
      if (packet.eos) {
        const padding = position - granule;
        // Like FFmpeg, ignore impossible discard padding rather than dropping earlier frames.
        if (padding >= 0 && padding <= length) length -= padding;
      } else {
        position = granule;
      }
    }
    count += length;
    if (count * channels! * 4 > 128 * 1024 * 1024) throw new Error("Vorbis PCM exceeds size limit");
    if (length > 0) yield { sampleRate: sampleRate!, pts,
      channelData: frame.channelData.map(channel => channel.subarray(0, length)) };
  }
}

export function decodeVorbisTrack(track: MediaTrack): MediaAudioData {
  const { sampleRate, channels } = track.codecDescriptions[0]!;
  const frames = Array.from(decodeVorbisFrames(track), frame => frame.channelData);
  const count = frames.reduce((sum, frame) => sum + frame[0]!.length, 0);
  const channelData = Array.from({ length: channels! }, (_, channel) => {
    const data = new Float32Array(count);
    let offset = 0;
    for (const frame of frames) { data.set(frame[channel]!, offset); offset += frame[channel]!.length; }
    return data;
  });
  return { sampleRate: sampleRate!, channels: channels!, channelData };
}

/** Preserve compressed packets, using decoder overlap lengths for their timeline. */
export function demuxVorbisTrack(track: MediaTrack): MediaTrack {
  const { packets, extra } = readVorbisTrack(track);
  const audio = packets.slice(3);
  const samples: MediaSample[] = audio.map(packet => ({
    data: packet.data, pts: 0, dts: 0, cts: 0, duration: 0,
    size: packet.data.length, isKeyframe: true, sampleDescriptionIndex: 1
  }));
  let index = 1, position: number | undefined;
  for (const frame of decodeAudio("Vorbis", samples, extra)) {
    const sample = samples[index]!, packet = audio[index]!;
    position ??= audio[0]!.granule !== 0xffffffffffffffffn ? Number(audio[0]!.granule) : frame.pts;
    let duration = frame.channelData[0]!.length;
    // The overlap priming packet occupies the samples before the first decoded frame.
    if (index === 1) samples[0] = { ...samples[0]!, duration: frame.pts };
    const pts = position;
    let discardPaddingNs: number | undefined;
    position += duration;
    if (packet.granule !== 0xffffffffffffffffn) {
      const granule = Number(packet.granule);
      if (!Number.isSafeInteger(granule)) throw new Error("Invalid Vorbis granule");
      if (packet.eos) {
        const padding = position - granule;
        if (padding > 0 && padding <= duration) {
          duration -= padding;
          discardPaddingNs = Math.round(padding * 1e9 / track.timescale);
        }
      } else position = granule;
    }
    samples[index++] = { ...sample, pts, dts: pts, duration, ...(discardPaddingNs === undefined ? {} : { discardPaddingNs }) };
  }
  return { ...track, samples, codecDescriptions: [{ ...track.codecDescriptions[0]!, extraData: extra }] };
}
