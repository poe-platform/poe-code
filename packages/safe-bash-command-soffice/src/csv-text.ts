import type { SofficeBudget } from './budget.js';
import type { CsvExportOptions } from './csv.js';
import { SofficeError } from './contracts.js';

/** Text-cell primitive only: strings (including leading '=') remain inert.
 * Caller owns rows; yielded byte buffers transfer to the consumer. Staging and
 * publication belong to the conversion invocation, not this serializer.
 * Explicit UTF-8/UTF-16 product encodings; no workbook/formula qualification.
 */
export async function* exportCsvTextRows(
  rows: Iterable<readonly string[]>, options: CsvExportOptions, budget: SofficeBudget
): AsyncGenerator<Uint8Array, void, unknown> {
  budget.checkpoint();
  const { complete, fixedWidth, removeSpace, encoding, fieldSeparator, textSeparator, quoteAllText, bom, endianness } = options;
  const utf16 = encoding === 'UTF16';
  budget.charge('work', encoding.length + fieldSeparator.length + textSeparator.length);
  if (!complete || fixedWidth || removeSpace ||
      !['UTF8', '76', 'UTF16'].includes(encoding) ||
      (utf16 && endianness !== 'little' && endianness !== 'big') ||
      fieldSeparator.length !== 1 || textSeparator.length !== 1 ||
      [fieldSeparator, textSeparator].some(value => {
        const code = value.charCodeAt(0);
        return code === 0 || code === 10 || code === 13 || (code >= 0xd800 && code <= 0xdfff);
      }) || fieldSeparator === textSeparator) {
    throw new SofficeError('unsupported', 'unsupported CSV text output profile');
  }
  const separatorBytes = utf16 ? 2 : new TextEncoder().encode(fieldSeparator).length;
  const quoteBytes = utf16 ? 2 : new TextEncoder().encode(textSeparator).length;
  if (bom || utf16) {
    budget.charge('outputBytes', utf16 ? 2 : 3);
    budget.charge('work', utf16 ? 2 : 3);
    yield utf16 ? (endianness === 'little' ? Uint8Array.of(255, 254) : Uint8Array.of(254, 255)) : Uint8Array.of(239, 187, 191);
  }
  for (const row of rows) {
    budget.checkpoint();
    budget.charge('nodes', 1);
    let retained = 0;
    let output: Uint8Array;
    try {
      // Array reference slots are reserved before constructing row fragments.
      budget.charge('retainedBytes', 8 * row.length);
      retained += 8 * row.length;
      const fragments: string[] = [];
      let textLength = Math.max(0, row.length - 1) + 1;
      let byteLength = Math.max(0, row.length - 1) * separatorBytes + (utf16 ? 2 : 1);
      for (const cell of row) {
        budget.charge('nodes', 1);
        budget.charge('work', 1);
        let quoted = quoteAllText, quotes = 0;
        for (const character of cell) {
          budget.charge('work', 1);
          const point = character.codePointAt(0)!;
          if (point === 0 || (point >= 0xd800 && point <= 0xdfff)) throw new SofficeError('invalid-argument', 'invalid CSV text cell');
          const bytes = point < 128 ? 1 : point < 2048 ? 2 : point < 65536 ? 3 : 4;
          budget.charge('inputBytes', bytes);
          byteLength += utf16 ? 2 * character.length : bytes;
          if (character === textSeparator) quotes++;
          if (character === fieldSeparator || character === textSeparator || character === '\n' || character === '\r') quoted = true;
        }
        const length = cell.length + (quoted ? quotes + 2 : 0);
        byteLength += quoted ? (quotes + 2) * quoteBytes : 0;
        textLength += length;
        budget.charge('work', length);
        // Reserve replaced intermediate text and the final fragment.
        const reservation = 4 * length;
        budget.charge('retainedBytes', reservation);
        retained += reservation;
        fragments.push(quoted ? textSeparator + cell.replaceAll(textSeparator, () => textSeparator + textSeparator) + textSeparator : cell);
      }
      // Bound the joined text, join intermediate, and encoded row before allocation.
      budget.charge('outputBytes', byteLength);
      budget.charge('work', textLength + byteLength);
      const reservation = 4 * textLength + byteLength;
      budget.charge('retainedBytes', reservation);
      retained += reservation;
      const text = fragments.join(fieldSeparator) + '\n';
      output = new Uint8Array(byteLength);
      if (utf16) {
        const view = new DataView(output.buffer);
        for (let index = 0; index < text.length; index++) {
          budget.checkpoint();
          view.setUint16(index * 2, text.charCodeAt(index), endianness === 'little');
        }
      } else new TextEncoder().encodeInto(text, output);
    } finally {
      if (retained) budget.releaseRetainedBytes(retained);
    }
    yield output;
  }
  budget.checkpoint();
}
