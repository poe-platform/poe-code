import { PdftotextAdmissionError } from './admission.js';
import { encodePdftotextOutput, type EncodedOutput, type EncodingLimits } from './encoding.js';

/** Serialize one already qualified word box in output coordinates.
 * This primitive neither interprets glyphs nor transforms page/crop geometry.
 */
export function serializeBboxWord(text: string, box: readonly [number, number, number, number], signal: AbortSignal, overrides: Partial<EncodingLimits> = {}): EncodedOutput {
  signal.throwIfAborted();
  const limits = { decodedBytes: 16_777_216, outputBytes: 33_554_432, retainedBytes: 50_331_648, work: 134_217_728, ...overrides };
  for (const value of Object.values(limits)) {
    if (!Number.isSafeInteger(value) || value < 0) throw new PdftotextAdmissionError('Limits must be nonnegative checked integers');
  }
  const decodedBytes = text.length * 2, reservation = text.length * 64 + 2048, work = text.length * 20 + 1024;
  // Includes escaped chunks, array slots, joined strings, fixed attributes and
  // formatting temporaries. This is conservative retained-byte accounting.
  if (decodedBytes > limits.decodedBytes || reservation > limits.retainedBytes || work > limits.work) {
    throw new PdftotextAdmissionError('Bbox decode/retention/work limit exceeded');
  }
  if (!Array.isArray(box) || box.length !== 4) throw new PdftotextAdmissionError('Invalid bounding geometry');
  const scalars: [number, number, number, number] = [box[0], box[1], box[2], box[3]];
  if (!scalars.every(value => Number.isFinite(value) && Math.abs(value) < 1e21) || scalars[0] > scalars[2] || scalars[1] > scalars[3]) {
    throw new PdftotextAdmissionError('Invalid bounding geometry');
  }
  const coordinates = scalars.map(value => value.toFixed(6));
  const prefix = `<word xMin="${coordinates[0]}" yMin="${coordinates[1]}" xMax="${coordinates[2]}" yMax="${coordinates[3]}">`;
  let outputBytes = prefix.length + 8, serializedLength = outputBytes;
  if (outputBytes > limits.outputBytes || decodedBytes + serializedLength * 2 > limits.decodedBytes) {
    throw new PdftotextAdmissionError('Bbox output/decode limit exceeded');
  }
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i++) {
    signal.throwIfAborted();
    const cp = text.codePointAt(i)!;
    if (!(cp === 9 || cp === 10 || cp === 13 || (cp >= 32 && cp <= 0xd7ff) || (cp >= 0xe000 && cp <= 0xfffd) || (cp >= 0x10000 && cp <= 0x10ffff))) {
      throw new PdftotextAdmissionError('Text contains an invalid XML scalar');
    }
    if (cp > 0xffff) i++;
    // Single-pass escaping has the same order-sensitive result as escaping &
    // first, then apostrophe, quote, less-than and greater-than.
    const escaped = cp === 38 ? '&amp;' : cp === 39 ? '&apos;' : cp === 34 ? '&quot;' : cp === 60 ? '&lt;' : cp === 62 ? '&gt;' : undefined;
    outputBytes += escaped ? escaped.length : cp < 128 ? 1 : cp < 2048 ? 2 : cp < 65536 ? 3 : 4;
    serializedLength += escaped ? escaped.length : cp > 0xffff ? 2 : 1;
    if (outputBytes > limits.outputBytes || decodedBytes + serializedLength * 2 > limits.decodedBytes) {
      throw new PdftotextAdmissionError('Bbox output/decode limit exceeded');
    }
    chunks.push(escaped ?? String.fromCodePoint(cp));
  }
  const xml = `${prefix}${chunks.join('')}</word>\n`;
  const result = encodePdftotextOutput(xml, 'UTF-8', 'unix', signal, {
    decodedBytes: limits.decodedBytes - decodedBytes,
    outputBytes: limits.outputBytes,
    retainedBytes: limits.retainedBytes - reservation,
    work: limits.work - work,
  });
  return Object.freeze({ bytes: result.bytes, accounting: Object.freeze({
    ...result.accounting,
    decodedBytes: decodedBytes + result.accounting.decodedBytes,
    retainedBytes: decodedBytes + result.bytes.length + 512,
    peakRetainedBytes: reservation + result.accounting.peakRetainedBytes,
    work: work + result.accounting.work,
  }) });
}
