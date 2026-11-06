import { readOgg } from "@poe-code/audio-ast";
import { decodeAudio } from "@poe-code/media-codecs";
import { concatBytes } from "./binary.js";
import type { MediaAudioData, MediaTrack } from "./types.js";

/** Decode overlap windows before applying Ogg page granules and final padding. */
export function decodeVorbisTrack(track: MediaTrack): MediaAudioData {
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
  const { sampleRate, channels } = track.codecDescriptions[0]!;
  const frames: Float32Array[][] = [];
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
    frames.push(frame.channelData.map(channel => channel.subarray(0, length)));
  }
  const channelData = Array.from({ length: channels! }, (_, channel) => {
    const data = new Float32Array(count);
    let offset = 0;
    for (const frame of frames) { data.set(frame[channel]!, offset); offset += frame[channel]!.length; }
    return data;
  });
  return { sampleRate: sampleRate!, channels: channels!, channelData };
}
