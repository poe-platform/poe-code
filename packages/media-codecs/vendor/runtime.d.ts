export interface CodecRuntime {
  HEAPU8: Uint8Array;
  _malloc(size: number): number;
  _free(pointer: number): void;
  _audio_create(codec: number, sampleRate: number, channels: number): number;
  _audio_free(encoder: number): void;
  _audio_header(encoder: number, index: number): number;
  _audio_send(encoder: number, data: number, count: number): number;
  _audio_receive(encoder: number): number;
  _decoder_create(extra: number, length: number, maxPixels: number): number;
  _decoder_free(decoder: number): void;
  _decoder_send(decoder: number, data: number, length: number, pts: number, dts: number, duration: number): number;
  _decoder_receive(decoder: number): number;
}
export default function createCodecRuntime(options?: { printErr?: (text: string) => void; locateFile?: () => string }): CodecRuntime;
