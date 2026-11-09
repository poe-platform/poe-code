export interface X264EncoderRuntime {
  HEAPU8: Uint8Array;
  _malloc(size: number): number;
  _free(pointer: number): void;
  _preset_encoder_create(width: number, height: number, timescale: number, frameDuration: number, preset: number, bframes: number, qp: number, bitrate: number, zeroLatency: number, crf: number): number;
  _preset_encoder_frame(encoder: number, pixels: number, pts: number, keyframe: number): number;
  _preset_encoder_free(encoder: number): void;
}
export default function createX264EncoderRuntime(options?: { printErr?: (text: string) => void; locateFile?: () => string }): X264EncoderRuntime;
