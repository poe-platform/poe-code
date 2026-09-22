export type TesseractErrorCode = 'invalid-argument' | 'invalid-model' | 'invalid-raster' | 'limit' | 'cancelled' | 'closed' | 'unsupported' | 'partial-output';
export class TesseractError extends Error {
  constructor(readonly code: TesseractErrorCode, message: string, readonly resource?: string) {
    super(message); this.name = 'TesseractError';
  }
}
export type TesseractResource = 'modelBytes' | 'inputBytes' | 'pixels' | 'pages' | 'tensorElements' | 'retainedBytes' | 'beamCandidates' | 'dictionaryNodes' | 'work' | 'outputBytes';
export type TesseractLimits = Readonly<Record<TesseractResource, number>>;
/** Supplied bytes are not shipping approval. Verify digest and notices before recognition. */
export interface TesseractModelAsset {
  readonly bytes: Uint8Array;
  readonly sourceCommit: string;
  readonly sha256: string;
  readonly license: string;
  readonly notices: Uint8Array;
  readonly language: string;
  readonly profile: 'int8-float32-scalar' | 'float32-scalar';
}
export interface TesseractRaster {
  readonly width: number;
  readonly height: number;
  readonly dpi: number;
  readonly pixels: Uint8Array;
  /** gray8: 0 black, 255 white. binary8: 1 foreground, 0 background. */
  readonly format: 'gray8' | 'binary8';
}
export interface TesseractWord {
  readonly text: string;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  /** Native API conversion, never a raw neural score. */
  readonly confidence: number;
}
/** Future pipeline admission boundary; no implementation is qualified by this interface. */
export interface TesseractRecognitionRequest {
  readonly input: AsyncIterable<Uint8Array>;
  readonly models: readonly TesseractModelAsset[];
  readonly limits: TesseractLimits;
  readonly signal: AbortSignal;
  readonly psm: number;
  readonly oem: number;
}
export interface TesseractCapabilities {
  readonly rasterNormalization: false;
  readonly deskew: false;
  readonly segmentation: false;
  readonly recognition: false;
  readonly pdfRasterization: false;
}
export const tesseractCapabilities: TesseractCapabilities = Object.freeze({
  rasterNormalization: false, deskew: false, segmentation: false, recognition: false, pdfRasterization: false
});
