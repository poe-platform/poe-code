/** Public API of the vendored PDF.js 4.1.392 standalone decoder build. */
export class Jbig2Image {
  width: number;
  height: number;
  parse(data: Uint8Array): Uint8ClampedArray;
  parseChunks(chunks: Array<{ data: Uint8Array; start: number; end: number }>): Uint8Array | undefined;
}
export class JpxImage {
  width: number;
  height: number;
  componentsCount: number;
  failOnCorruptedImage: boolean;
  tiles: Array<{ left: number; top: number; width: number; height: number; items: Uint8ClampedArray }>;
  parse(data: Uint8Array): void;
}
