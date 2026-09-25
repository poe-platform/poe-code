/** All offsets and sizes refer to the original byte buffer. Unknown chunks are retained. */
export interface AudioNode {
  type: string;
  offset: number;
  size: number;
  data: Uint8Array;
  children?: AudioNode[];
  fields?: Record<string, unknown>;
}
export interface AudioStream {
  codec: string;
  sampleRate: number;
  channels: number;
  bitsPerSample?: number;
  samples: number;
  duration: number;
  bitrate: number;
}
export interface AudioPicture {
  type: number;
  mime: string;
  description: string;
  data: Uint8Array;
  width?: number;
  height?: number;
  depth?: number;
  colors?: number;
}
export type AudioTags = Record<string, string>;
export interface AudioAst {
  format: "wav" | "mp3" | "flac" | "ogg" | "m4a";
  data: Uint8Array;
  nodes: AudioNode[];
  streams: AudioStream[];
  tags: AudioTags;
  pictures: AudioPicture[];
  duration: number;
  bitrate: number;
}
export interface PcmAudio {
  sampleRate: number;
  /** Planar normalized samples. Integer PCM uses [-1, 1); float PCM may exceed this. */
  channels: Float64Array[];
}
export interface WavOptions {
  bitsPerSample?: 8 | 16 | 24 | 32 | 64;
  float?: boolean;
  tags?: AudioTags;
}
export type AudioEffect =
  | { type: "trim"; startSec: number; durationSec?: number }
  | { type: "pad"; leadSec: number; trailSec: number }
  | { type: "rate"; sampleRate: number; method?: "linear" | "sinc" }
  | { type: "channels"; channels: number; matrix?: number[][] }
  | { type: "extract"; channels: number[] }
  | { type: "normalize"; targetDb: number }
  | { type: "fade"; inSec: number; outSec: number };
export interface AudioStats {
  peak: number;
  rms: number;
  peakDbfs: number;
  rmsDbfs: number;
  dcOffset: number;
  crestFactor: number;
  zeroCrossings: number;
}
