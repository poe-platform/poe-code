// Advisory grammar: registered FFmpeg 9.0.1 concatdec.c, aviobuf.c and parseutils.c.
// Existing source notices and GPL/LGPL terms apply; see NOTICE.
import { byteText, textBytes, token } from './bytes.js';

/** concat.c consumes a filename, then a run of separators. An initial empty
 * member remains a native attempted access; trailing separators add no member. */
export function* concatProtocolMembers(input: string): Generator<string> {
  let start = 0;
  while (start < input.length) {
    let end = start;
    while (end < input.length && input[end] !== '|') end++;
    yield input.slice(start, end);
    while (input[end] === '|') end++;
    start = end;
  }
}

/** concatf reads one C-string buffer with av_get_token CR/LF delimiters.
 * Quoted/escaped newlines are data, unlike concat demuxer line boundaries. */
export function* concatfFiles(content: Uint8Array): Generator<{ value: Uint8Array; span: { start: number; end: number } }> {
  const nul = content.indexOf(0);
  const input = byteText(content.subarray(0, nul < 0 ? content.length : nul));
  let start = 0;
  while (start < input.length) {
    let first = start;
    while (first < input.length && ' \n\t\r'.includes(input[first])) first++;
    if (first === input.length) break;
    const parsed = token(input, start, '\r\n');
    yield { value: textBytes(parsed.value), span: { start, end: parsed.end } };
    start = parsed.end + (parsed.end < input.length ? 1 : 0);
  }
}

/** AVIO line boundaries are CR, LF and NUL; CRLF consumes one boundary. */
export function* manifestLines(input: string, delimiters = '\r\n\0'): Generator<{ line: string; span: { start: number; end: number } }> {
  let start = 0;
  while (start < input.length) {
    let end = start;
    while (end < input.length && !delimiters.includes(input[end])) end++;
    yield { line: input.slice(start, end), span: { start, end } };
    start = end + (input[end] === '\r' && input[end + 1] === '\n' ? 2 : 1);
  }
}

/** parseutils.c av_parse_time(duration=1), including its clock-field widths,
 * fractional truncation, suffixes and signed 64-bit overflow checks. This only
 * predicts a grammar stop; it never raises a native execution error early. */
function concatDuration(input: string): boolean {
  const negative = input.startsWith('-');
  const start = negative ? 1 : 0;
  const digit = (index: number) => input[index] >= '0' && input[index] <= '9';
  const clock = (widths: readonly number[]): { end: number; seconds: bigint } | undefined => {
    let cursor = start;
    const fields: number[] = [];
    for (const [index, width] of widths.entries()) {
      const first = cursor;
      while (cursor - first < width && digit(cursor)) cursor++;
      if (cursor === first) return;
      const value = Number(input.slice(first, cursor));
      if ((width === 2 && value > 59) || index < widths.length - 1 && input[cursor++] !== ':') return;
      fields.push(value);
    }
    const seconds = fields.length === 3 ? fields[0] * 3600 + fields[1] * 60 + fields[2] : fields[0] * 60 + fields[1];
    return { end: cursor, seconds: BigInt(seconds) };
  };
  const parsed = clock([4, 2, 2]) ?? clock([2, 2]);
  let cursor = parsed?.end ?? start;
  let seconds = parsed?.seconds;
  const maximum = 9223372036854775807n, minimum = -9223372036854775808n;
  if (seconds === undefined) {
    const sign = input[cursor] === '-' ? -1n : 1n;
    if (input[cursor] === '-' || input[cursor] === '+') cursor++;
    const first = cursor;
    while (digit(cursor)) cursor++;
    if (cursor === first) return false;
    let significant = first;
    while (input[significant] === '0' && significant < cursor) significant++;
    // Bound conversion itself, even for a manifest full of leading zeros.
    if (cursor - significant > 19) return false;
    seconds = BigInt(input.slice(significant, cursor) || '0') * sign;
    if (seconds < minimum || seconds > maximum) return false;
  }
  let microseconds = 0n;
  if (input[cursor] === '.') {
    cursor++;
    let weight = 100000n;
    while (digit(cursor)) {
      if (weight) { microseconds += BigInt(input[cursor]) * weight; weight /= 10n; }
      cursor++;
    }
  }
  let scale = 1000000n;
  if (input.startsWith('ms', cursor)) { scale = 1000n; microseconds /= 1000n; cursor += 2; }
  else if (input.startsWith('us', cursor)) { scale = 1n; microseconds = 0n; cursor += 2; }
  else if (input[cursor] === 's') cursor++;
  if (cursor !== input.length || seconds > maximum / scale || seconds < minimum / scale) return false;
  const value = seconds * scale + microseconds;
  return value <= maximum && !(negative && value === minimum);
}

/** A predictive syntax stop leaves all validation and subsequent access native. */
export function* concatFiles(content: Uint8Array): Generator<{ index: number; value: Uint8Array; span: { start: number; end: number }; options: Map<string, string> }> {
  let index = 0;
  let file = false, stream = false;
  // concat_parse_script stores options on the current file; open_file applies
  // them only after parsing. Retain that dictionary through the yielded entry.
  let options = new Map<string, string>();
  // concatdec.c ParseSyntax: k/i/d use literal whitespace-delimited words;
  // only s uses av_get_token. Policy, integer interpretation and codec lookup
  // remain native decisions rather than an eager validation/replay algorithm.
  const syntax: Readonly<Record<string, { args: string; context?: 'file' | 'stream' }>> = {
    ffconcat: { args: 'kk' }, file: { args: 's' },
    duration: { args: 'd', context: 'file' }, inpoint: { args: 'd', context: 'file' }, outpoint: { args: 'd', context: 'file' },
    file_packet_meta: { args: 'ks', context: 'file' }, file_packet_metadata: { args: 's', context: 'file' }, option: { args: 'ks', context: 'file' },
    stream: { args: '' }, exact_stream_id: { args: 'i', context: 'stream' }, stream_meta: { args: 'ks', context: 'stream' },
    stream_codec: { args: 'k', context: 'stream' }, stream_extradata: { args: 'k', context: 'stream' }, chapter: { args: 'idd' },
  };
  for (const { line, span } of manifestLines(byteText(content))) {
    const readIndex = index++;
    // get_keyword splits whitespace without interpreting quotes or escapes.
    let cursor = 0;
    const word = () => {
      while (cursor < line.length && ' \t\r\n'.includes(line[cursor])) cursor++;
      const start = cursor;
      while (cursor < line.length && !' \t\r\n'.includes(line[cursor])) cursor++;
      return line.slice(start, cursor);
    };
    const keyword = word();
    if (!keyword || keyword.startsWith('#')) continue;
    const directive = Object.hasOwn(syntax, keyword) ? syntax[keyword] : undefined;
    if (!directive) throw new SyntaxError('Unknown concat directive; subsequent access depends on native validation');
    if (directive.context === 'file' && !file || directive.context === 'stream' && !stream) throw new SyntaxError(`Concat ${keyword} without ${directive.context}`);
    const args = [...directive.args].map(type => {
      if (type !== 's') {
        const value = word();
        if (type === 'd' && !concatDuration(value)) throw new SyntaxError('Invalid concat duration; subsequent access depends on native validation');
        return value;
      }
      const parsed = token(line, cursor, ' \t\r\n');
      cursor = parsed.end;
      if (!parsed.value) throw new SyntaxError('Empty concat string argument');
      return parsed.value;
    });
    if (keyword === 'ffconcat' && (args[0] !== 'version' || args[1] !== '1.0')) throw new SyntaxError('Invalid concat version');
    if (keyword === 'file_packet_metadata') {
      // dict.c parses the already-unquoted directive argument again with
      // av_get_token. Only the first unprotected '=' separates key/value;
      // pairs_sep is empty, so colons and additional equals belong to value.
      const key = token(args[0], 0, '=');
      const value = key.end < args[0].length ? token(args[0], key.end + 1, '').value : '';
      if (!key.value || !value) throw new SyntaxError('Invalid concat metadata; subsequent access depends on native validation');
    }
    if (keyword === 'file') {
      file = true;
      options = new Map<string, string>();
      yield { index: readIndex, value: textBytes(args[0]), span, options };
    } else if (keyword === 'option') {
      options.set(args[0], args[1]);
    } else if (keyword === 'stream') stream = true;
  }
  if (!file) throw new SyntaxError('Concat manifest requires a file directive');
}
