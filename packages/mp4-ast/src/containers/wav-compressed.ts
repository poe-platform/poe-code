import { decodeAudio } from "@poe-code/media-codecs";
import type { MediaAudioData } from "../types.js";
import { readMp3Frames } from "./mp3-frames.js";
import type { WavHeader } from "./wav-header.js";

export function decodeCompressedWav(bytes: Uint8Array, header: WavHeader): MediaAudioData {
  const data = bytes.subarray(header.dataOffset, header.dataOffset + header.dataSize);
  const { sampleRate, channels } = header;
  let pts = 0;
  const packets = header.formatTag === 85 ? readMp3Frames(data).map(frame => {
    const packet = { data: data.subarray(frame.offset, frame.offset + frame.size), pts, dts: pts, duration: frame.samples };
    pts += frame.samples;
    return packet;
  }) : [{ data, pts: 0, dts: 0, duration: 0 }];
  // WAVE_FORMAT_AAC stores AudioSpecificConfig in WAVEFORMATEX and can pack
  // several raw access units into the data chunk. It has no per-frame timestamps.
  let extra: Uint8Array = new Uint8Array();
  if (header.formatTag === 255) {
    if (header.formatOffset === undefined || header.formatSize === undefined || header.formatSize < 18) throw new Error("Missing WAV AAC configuration");
    const format = new DataView(bytes.buffer, bytes.byteOffset + header.formatOffset, header.formatSize);
    const size = format.getUint16(16, true);
    if (size > header.formatSize - 18) throw new Error("Truncated WAV AAC configuration");
    extra = bytes.subarray(header.formatOffset + 18, header.formatOffset + 18 + size);
  }
  const frames: (readonly Float32Array[])[] = [];
  let count = 0;
  for (const frame of decodeAudio(header.formatTag === 85 ? "MP3" : "AAC", packets, extra)) {
    if (frame.sampleRate !== sampleRate || frame.channelData.length !== channels) throw new Error("WAV decoded dimensions differ from format");
    count += frame.channelData[0]!.length;
    if (count * channels * 4 > 128 * 1024 * 1024) throw new Error("Unsupported WAV PCM dimensions");
    frames.push(frame.channelData);
  }
  const channelData = Array.from({ length: channels }, () => new Float32Array(count));
  let offset = 0;
  for (const frame of frames) {
    for (let channel = 0; channel < channels; channel++) channelData[channel]!.set(frame[channel]!, offset);
    offset += frame[0]!.length;
  }
  return { sampleRate, channels, channelData };
}
