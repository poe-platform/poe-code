export interface OcrLimits {
  maxInputBytes?: number;
  maxModelBytes?: number;
  maxPixels?: number;
  maxOutputBytes?: number;
  timeoutMs?: number;
}
export interface OcrOptions {
  /** Tesseract language identifier. Defaults to eng. Other languages require model bytes. */
  language?: string;
  model?: Uint8Array;
  psm?: number;
  dpi?: number;
  limits?: OcrLimits;
  signal?: AbortSignal;
}
export interface OcrResult {
  text: string;
  tsv: string;
  hocr: string;
  width: number;
  height: number;
  confidence: number;
}
export function recognize(image: Uint8Array, options?: OcrOptions): Promise<OcrResult>;
export interface PdfOcrOptions extends OcrOptions {
  skipText?: boolean;
  maxPages?: number;
}
export interface PdfOcrResult { pdf: Uint8Array; text: string; pages: number; }
export function recognizePdf(pdf: Uint8Array, options?: PdfOcrOptions): Promise<PdfOcrResult>;
export interface TesseractRequest {
  input: string;
  output?: string;
  modelPath?: string;
  language: string;
  psm: number;
  dpi: number;
  format: 'txt' | 'tsv' | 'hocr';
}
/** Returns informational output or a request for the host to supply image/model bytes. */
export function parseTesseract(args: string[]): string | TesseractRequest;
export interface OcrMyPdfRequest {
  input: string;
  output?: string;
  modelPath?: string;
  language: string;
  dpi: number;
  skipText: boolean;
  sidecar?: string;
}
export function parseOcrmypdf(args: string[]): string | OcrMyPdfRequest;
