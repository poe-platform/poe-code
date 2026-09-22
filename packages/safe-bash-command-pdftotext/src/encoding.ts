import { PdftotextAdmissionError } from './admission.js';

export type OutputEncoding = 'UTF-8' | 'UTF-16' | 'Latin1' | 'ASCII7';
export interface EncodingLimits {
  readonly decodedBytes: number;
  readonly outputBytes: number;
  readonly retainedBytes: number;
  readonly work: number;
}
export interface EncodedOutput {
  readonly bytes: Uint8Array;
  readonly accounting: Readonly<EncodingLimits & { inputBytes: 0; peakRetainedBytes: number }>;
}

/** Encode already extracted canonical text; LF denotes an output line break.
 * Strict profile: reject unmappable text instead of silently dropping glyphs.
 * UTF-16 uses big-endian units without a BOM. No Unicode normalization.
 */
export function encodePdftotextOutput(text: string, encoding: OutputEncoding, eol: 'unix' | 'dos' | 'mac', signal: AbortSignal, overrides: Partial<EncodingLimits> = {}): EncodedOutput {
  signal.throwIfAborted();
  const limits = { decodedBytes: 16_777_216, outputBytes: 33_554_432, retainedBytes: 50_331_648, work: 134_217_728, ...overrides };
  for (const value of Object.values(limits)) {
    if (!Number.isSafeInteger(value) || value < 0) throw new PdftotextAdmissionError('Limits must be nonnegative checked integers');
  }
  if (!['UTF-8', 'UTF-16', 'Latin1', 'ASCII7'].includes(encoding)) throw new PdftotextAdmissionError('Unsupported output encoding');
  if (!['unix', 'dos', 'mac'].includes(eol)) throw new PdftotextAdmissionError('Invalid EOL profile');
  const decodedBytes = text.length * 2, work = text.length * 8 + 1;
  // Reserve fixed encoder/result structures, including the zero-byte case.
  if (decodedBytes > limits.decodedBytes || decodedBytes + 512 > limits.retainedBytes || work > limits.work) {
    throw new PdftotextAdmissionError('Encoding decode/retention/work limit exceeded');
  }
  const sizeOf = (cp: number): number => {
    if (encoding === 'UTF-16') return cp <= 0xffff ? 2 : 4;
    if (encoding === 'UTF-8') return cp < 128 ? 1 : cp < 2048 ? 2 : cp < 65536 ? 3 : 4;
    if (cp > (encoding === 'Latin1' ? 255 : 127)) throw new PdftotextAdmissionError('Unicode scalar is not representable in output encoding');
    return 1;
  };
  let outputBytes = 0;
  for (let i = 0; i < text.length; i++) {
    signal.throwIfAborted();
    const cp = text.codePointAt(i)!;
    if (cp >= 0xd800 && cp <= 0xdfff) throw new PdftotextAdmissionError('Undecodable Unicode scalar in output');
    if (cp > 0xffff) i++;
    outputBytes += cp === 10 && eol === 'dos' ? sizeOf(13) + sizeOf(10) : sizeOf(cp === 10 && eol === 'mac' ? 13 : cp);
    if (outputBytes > limits.outputBytes || outputBytes > limits.retainedBytes - decodedBytes - 512) {
      throw new PdftotextAdmissionError('Encoding output/retention limit exceeded');
    }
  }
  // All scalar validity, expansion and allocation charges were admitted above.
  const bytes = new Uint8Array(outputBytes);
  let offset = 0;
  const emit = (cp: number): void => {
    if (encoding === 'UTF-16') {
      if (cp > 0xffff) {
        const high = 0xd800 + ((cp - 0x10000) >> 10), low = 0xdc00 + ((cp - 0x10000) & 1023);
        bytes[offset++] = high >> 8; bytes[offset++] = high & 255;
        bytes[offset++] = low >> 8; bytes[offset++] = low & 255;
      } else { bytes[offset++] = cp >> 8; bytes[offset++] = cp & 255; }
    } else if (encoding !== 'UTF-8' || cp < 128) bytes[offset++] = cp;
    else if (cp < 2048) { bytes[offset++] = 0xc0 | (cp >> 6); bytes[offset++] = 0x80 | (cp & 63); }
    else if (cp < 65536) {
      bytes[offset++] = 0xe0 | (cp >> 12); bytes[offset++] = 0x80 | ((cp >> 6) & 63); bytes[offset++] = 0x80 | (cp & 63);
    } else {
      bytes[offset++] = 0xf0 | (cp >> 18); bytes[offset++] = 0x80 | ((cp >> 12) & 63);
      bytes[offset++] = 0x80 | ((cp >> 6) & 63); bytes[offset++] = 0x80 | (cp & 63);
    }
  };
  for (let i = 0; i < text.length; i++) {
    signal.throwIfAborted();
    const cp = text.codePointAt(i)!;
    if (cp > 0xffff) i++;
    if (cp === 10 && eol === 'dos') { emit(13); emit(10); }
    else emit(cp === 10 && eol === 'mac' ? 13 : cp);
  }
  const retainedBytes = decodedBytes + outputBytes + 512;
  return Object.freeze({ bytes, accounting: Object.freeze({ inputBytes: 0, decodedBytes, outputBytes, retainedBytes, peakRetainedBytes: retainedBytes, work }) });
}
