import { TesseractError } from './contracts.js';
import { type createTesseractBudget } from './budget.js';

/** Top-origin layout supplied by a separately qualified recognition engine. */
export interface TesseractTsvRow {
  readonly level: 1 | 2 | 3 | 4 | 5;
  readonly page: number;
  readonly block: number;
  readonly paragraph: number;
  readonly line: number;
  readonly word: number;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  /** Already converted API confidence: -1 for nonwords, 0..100 for words. */
  readonly confidence: number;
  readonly text: string;
}

const header = 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n';

/** One owned UTF8 TSV document; no inference, filesystem access or confidence estimation. */
export function renderTesseractTsv(
  rows: readonly TesseractTsvRow[], budget: ReturnType<typeof createTesseractBudget>, signal: AbortSignal
): { readonly bytes: Uint8Array; dispose(): void } {
  const check = () => {
    budget.checkpoint();
    if (signal.aborted) throw new TesseractError('cancelled', 'TSV rendering cancelled');
  };
  const invalid = () => new TesseractError('invalid-argument', 'invalid TSV hierarchy, rectangle, confidence or text');
  check();
  if (!Array.isArray(rows)) throw invalid();
  let retained = 0, output = 0;
  const dispose = () => {
    if (retained && budget.used('retainedBytes')) budget.release('retainedBytes', retained);
    if (output && budget.used('outputBytes')) budget.release('outputBytes', output);
    retained = 0; output = 0;
  };
  try {
    // Fixed scratch ceiling covers numeric row prefixes and five parent references.
    budget.charge('retainedBytes', 4096); retained = 4096;
    const parents: (TesseractTsvRow | undefined)[] = [];
    const counters = [0, 0, 0, 0, 0];
    let size = header.length;
    const prefix = (r: TesseractTsvRow) => [r.level, r.page, r.block, r.paragraph, r.line, r.word,
      r.left, r.top, r.width, r.height, r.level === 5 ? r.confidence.toFixed(6) : '-1'].join('\t') + '\t';
    for (const r of rows) {
      check(); budget.charge('work', 12);
      if (!r || typeof r !== 'object') throw invalid();
      const ids = [r.page, r.block, r.paragraph, r.line, r.word];
      if (!Number.isInteger(r.level) || r.level < 1 || r.level > 5 || typeof r.text !== 'string') throw invalid();
      for (const n of [...ids, r.left, r.top, r.width, r.height]) {
        if (!Number.isSafeInteger(n) || n < 0) throw invalid();
      }
      budget.charge('inputBytes', 88); // Eleven numeric fields, binary64 payload.
      if (r.text.length > Math.floor(Number.MAX_SAFE_INTEGER / 2)) throw invalid();
      budget.charge('inputBytes', r.text.length * 2); // Caller-owned UTF16 text payload; no copy.
      const depth = r.level - 1;
      if (ids[depth] !== counters[depth]! + 1) throw invalid();
      for (let i = 0; i < depth; i++) if (ids[i] !== counters[i]) throw invalid();
      for (let i = depth + 1; i < 5; i++) if (ids[i] !== 0) throw invalid();
      const parent = parents[depth - 1];
      if (depth > 0 && (!parent || r.left < parent.left || r.top < parent.top ||
          r.width > parent.width - (r.left - parent.left) || r.height > parent.height - (r.top - parent.top))) throw invalid();
      if (depth === 0 && (r.left !== 0 || r.top !== 0 || r.width < 1 || r.height < 1)) throw invalid();
      if (r.level === 5) {
        if (!Number.isFinite(r.confidence) || r.confidence < 0 || r.confidence > 100 || !r.text.length || !r.width || !r.height) throw invalid();
      } else if (r.confidence !== -1 || r.text !== '') throw invalid();
      counters[depth] = ids[depth]!; parents[depth] = r;
      for (let i = depth + 1; i < 5; i++) { counters[i] = 0; parents[i] = undefined; }
      let textBytes = 0;
      for (let i = 0; i < r.text.length; i++) {
        if (i % 65536 === 0) check();
        budget.charge('work', 1);
        const c = r.text.charCodeAt(i);
        if (c < 32 || c === 127) throw invalid(); // Explicit rejection rather than ambiguous TSV escaping.
        if (c >= 0xd800 && c <= 0xdbff) {
          const low = r.text.charCodeAt(++i);
          if (!(low >= 0xdc00 && low <= 0xdfff)) throw invalid();
          budget.charge('work', 1); textBytes += 4;
        } else {
          if (c >= 0xdc00 && c <= 0xdfff) throw invalid();
          textBytes += c < 128 ? 1 : c < 2048 ? 2 : 3;
        }
      }
      const addition = prefix(r).length + textBytes + 1;
      if (!Number.isSafeInteger(addition) || addition > Number.MAX_SAFE_INTEGER - size) throw new TesseractError('limit', 'TSV size overflow', 'outputBytes');
      size += addition;
    }
    // Complete preflight precedes allocation and byte output; no partial TSV on error.
    budget.charge('work', size);
    budget.charge('outputBytes', size); output = size;
    budget.charge('retainedBytes', size); retained += size;
    const bytes = new Uint8Array(size);
    let offset = 0;
    const write = (text: string) => {
      for (let i = 0; i < text.length; i++) {
        if (i % 65536 === 0) check();
        let c = text.charCodeAt(i);
        if (c >= 0xd800 && c <= 0xdbff) c = 0x10000 + ((c - 0xd800) << 10) + text.charCodeAt(++i) - 0xdc00;
        if (c < 128) bytes[offset++] = c;
        else if (c < 2048) { bytes[offset++] = 0xc0 | (c >> 6); bytes[offset++] = 0x80 | (c & 63); }
        else if (c < 65536) { bytes[offset++] = 0xe0 | (c >> 12); bytes[offset++] = 0x80 | ((c >> 6) & 63); bytes[offset++] = 0x80 | (c & 63); }
        else { bytes[offset++] = 0xf0 | (c >> 18); bytes[offset++] = 0x80 | ((c >> 12) & 63); bytes[offset++] = 0x80 | ((c >> 6) & 63); bytes[offset++] = 0x80 | (c & 63); }
      }
    };
    write(header);
    for (const r of rows) { check(); write(prefix(r)); write(r.text); bytes[offset++] = 10; }
    check();
    budget.release('retainedBytes', 4096); retained -= 4096;
    return { bytes, dispose };
  } catch (error) { dispose(); throw error; }
}
