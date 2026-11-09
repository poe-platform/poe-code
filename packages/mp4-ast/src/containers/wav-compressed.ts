import { readAc3Header } from "./ac3.js";
import { decodeAudio } from "@poe-code/media-codecs";
import { mpegFrame } from "@poe-code/audio-ast";
import type { MediaSample, MediaAudioData } from "../types.js";
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

/** WAVE byte blocks may contain multiple compressed codec packets. */
export function compressedWavPackets(data: Uint8Array, header: WavHeader): MediaSample[] | undefined {
  if (![80, 85, 0x2000].includes(header.formatTag)) return undefined;
  const samples: MediaSample[] = [];
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0, pts = 0;
  while (offset < data.length) {
    let size: number, count: number, rate: number;
    if (header.formatTag === 0x2000) {
      const frame = readAc3Header(data, offset);
      size = frame.size;
      rate = frame.sampleRate;
      count = 1536;
    } else {
      if (offset + 4 > data.length) throw new Error("Truncated MPEG WAV frame");
      const word = view.getUint32(offset);
      if (header.formatTag === 85) {
        const frame = mpegFrame(word, offset, data.length);
        size = frame.frameSize; count = frame.count; rate = frame.rate;
      } else {
        const version = (word >>> 19) & 3, bitrateIndex = (word >>> 12) & 15, rateIndex = (word >>> 10) & 3;
        if (word >>> 21 !== 0x7ff || version === 1 || ((word >>> 17) & 3) !== 2 ||
            !bitrateIndex || bitrateIndex === 15 || rateIndex === 3) throw new Error("Invalid MP2 WAV frame");
        rate = [44100, 48000, 32000][rateIndex]! / (version === 3 ? 1 : version === 2 ? 2 : 4);
        const bitrate = (version === 3
          ? [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384]
          : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160])[bitrateIndex]!;
        size = Math.floor(144000 * bitrate / rate) + ((word >>> 9) & 1);
        count = 1152;
      }
    }
    if (offset + size > data.length) throw new Error("Truncated compressed WAV frame");
    const duration = count * header.sampleRate / rate;
    samples.push({ data: data.subarray(offset, offset + size), offset: header.dataOffset + offset,
      dts: pts, pts, cts: 0, duration, size, isKeyframe: true, sampleDescriptionIndex: 1 });
    pts += duration;
    offset += size;
  }
  return samples;
}
