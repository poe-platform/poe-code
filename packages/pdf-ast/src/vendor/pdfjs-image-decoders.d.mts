/** Public API of the vendored PDF.js 4.1.392 standalone decoder build. */
export class Jbig2Image {
  constructor(onImageDimensions?: (width: number, height: number) => void, onAllocation?: (bytes: number) => void);
  width: number;
  height: number;
  parse(data: Uint8Array, options?: { packed?: boolean }): Uint8ClampedArray;
  parseChunks(chunks: Array<{ data: Uint8Array; start: number; end: number }>): Uint8Array | undefined;
}
export class JpxImage {
  constructor(onImageDimensions?: (width: number, height: number) => void, onAllocation?: (bytes: number) => void);
  width: number;
  height: number;
  componentsCount: number;
  failOnCorruptedImage: boolean;
  tiles: Array<{ left: number; top: number; width: number; height: number; items: Uint8ClampedArray }>;
  parse(data: Uint8Array): void;
}

export class JpegImage {
  constructor(options?: {
    colorTransform?: number | undefined;
    decodeTransform?: Int32Array | undefined;
    onImageDimensions?: ((width: number, height: number) => void) | undefined;
    /** Typed buffers and conservative metadata charges, before allocation. */
    onAllocation?: ((bytes: number) => void) | undefined;
  });
  width: number;
  height: number;
  numComponents: number;
  parse(data: Uint8Array): void;
  getData(options: { width: number; height: number; forceRGB?: boolean; forceRGBA?: boolean; isSourcePDF?: boolean; rowStart?: number; rowCount?: number }): Uint8ClampedArray;
}
