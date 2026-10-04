/** Public API of the vendored PDF.js 4.1.392 standalone decoder build. */
export interface Jbig2Source { readonly length: number }
export interface Jbig2ReadRequest {readonly source: Jbig2Source; readonly position: number}
export class Jbig2Image {
  constructor(onImageDimensions?: (width: number, height: number) => void, onAllocation?: (bytes: number) => void);
  width: number;
  height: number;
  parse(data: Uint8Array, options?: { packed?: boolean }): Uint8ClampedArray;
  parseSteps(data: Jbig2Source, options?: {packed?: boolean}): Generator<Jbig2ReadRequest, Uint8ClampedArray, number | undefined>;
  parseChunksSteps(chunks: Array<{data: Jbig2Source; start: number; end: number}>): Generator<Jbig2ReadRequest, Uint8Array | undefined, number | undefined>;
  parseChunks(chunks: Array<{ data: Uint8Array; start: number; end: number }>): Uint8Array | undefined;
}
export interface JpxStoredVector { readonly position:number; readonly length:number; readonly bytesPerElement:number; readonly integer?:boolean }
export type JpxReadRequest = number | {start:number;end:number} | {kind:"vector-allocate";length:number} | {kind:"vector-read";vector:JpxStoredVector;index:number} | {kind:"vector-write";vector:JpxStoredVector;index:number;value:number};
export class JpxImage {
  constructor(onImageDimensions?: (width: number, height: number) => void, onAllocation?: (bytes: number) => void, options?: {storedPlanes?:boolean});
  width: number;
  height: number;
  componentsCount: number;
  failOnCorruptedImage: boolean;
  tiles: Array<{ left: number; top: number; width: number; height: number; items: Uint8ClampedArray }>;
  parse(data: Uint8Array): void;
  storedTiles: {length:number;records:JpxStoredVector};
  parseSteps(data: {readonly length:number}): Generator<JpxReadRequest, void, number | Uint8Array | undefined>;
}

export type JpegReadRequest = number | {start:number;end:number} | {kind:"block-allocate";length:number} | {kind:"block-read";position:number} | {kind:"block-write";position:number;values:Int16Array} | {kind:"sample";position:number;index:number};
export type JpegReadResult = number | Uint8Array | Int16Array | undefined;
export class JpegImage {
  constructor(options?: {
    colorTransform?: number | undefined;
    storedBlocks?: boolean;
    decodeTransform?: Int32Array | undefined;
    onImageDimensions?: ((width: number, height: number) => void) | undefined;
    /** Typed buffers and conservative metadata charges, before allocation. */
    onAllocation?: ((bytes: number) => void) | undefined;
  });
  width: number;
  height: number;
  numComponents: number;
  parse(data: Uint8Array): void;
  parseSteps(data: {readonly length: number}): Generator<JpegReadRequest, void, JpegReadResult>;
  getDataSteps(options: { width: number; height: number; forceRGB?: boolean; forceRGBA?: boolean; isSourcePDF?: boolean; rowStart?: number; rowCount?: number }): Generator<JpegReadRequest, Uint8ClampedArray, JpegReadResult>;
  getData(options: { width: number; height: number; forceRGB?: boolean; forceRGBA?: boolean; isSourcePDF?: boolean; rowStart?: number; rowCount?: number }): Uint8ClampedArray;
}
