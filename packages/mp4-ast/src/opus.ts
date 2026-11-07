import type { readOgg } from "@poe-code/audio-ast";
import { decodeAudio } from "@poe-code/media-codecs";
import type { MediaAudioData } from "./types.js";

/** Decode each logical stream independently, removing pre-skip and final granule padding. */
export function decodeOpusPackets(packets: ReturnType<typeof readOgg>["packets"]): MediaAudioData {
  const frames: Float32Array[][] = [];
  let count = 0;
  const channels = packets[0]!.data[9]!;
  for (let start = 0; start < packets.length;) {
    let end = start + 1;
    while (end < packets.length && !packets[end]!.bos) end++;
    const header = packets[start]!.data;
    const preSkip = new DataView(header.buffer, header.byteOffset, header.byteLength).getUint16(10, true);
    const audio = packets.slice(start + 2, end);
    let position = 0, index = 0;
    for (const frame of decodeAudio("Opus", audio.map(packet => ({ data: packet.data, pts: 0, dts: 0, duration: 0 })), header)) {
      if (frame.sampleRate !== 48000 || frame.channelData.length !== channels) throw new Error("Invalid Opus decoded dimensions");
      const packet = audio[index++]!;
      const length = frame.channelData[0]!.length;
      const from = Math.min(length, Math.max(0, preSkip - position));
      const to = packet.eos ? Number(packet.granule) - position : length;
      if (!Number.isSafeInteger(to) || to < 0 || to > length) throw new Error("Invalid Opus final granule");
      count += Math.max(0, to - from);
      if (count * channels * 4 > 128 * 1024 * 1024) throw new Error("Opus PCM exceeds size limit");
      frames.push(frame.channelData.map(channel => channel.subarray(from, Math.max(from, to))));
      position += length;
    }
    start = end;
  }
  const channelData = Array.from({ length: channels }, (_, channel) => {
    const data = new Float32Array(count);
    let offset = 0;
    for (const frame of frames) { data.set(frame[channel]!, offset); offset += frame[channel]!.length; }
    return data;
  });
  return { sampleRate: 48000, channels, channelData };
}
