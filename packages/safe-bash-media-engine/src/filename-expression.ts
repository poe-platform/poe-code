import { byteText } from './bytes.js';
export type FilenameDialect = 'sequence' | 'imagemagick' | 'dash' | 'dash-resource' | 'hls';
export interface FilenameExpression {
  readonly dialect: FilenameDialect;
  readonly complete: boolean;
  /** Values use the reversible byte alphabet used by the frontend grammars. */
  readonly tokens: readonly { kind: 'literal' | 'counter' | 'property' | 'template'; value: string; start: number; end: number }[];
}
/** Tokenize filename languages only in a grammar position that admits them.
 * No frame expansion, metadata evaluation, strftime, globbing or filesystem I/O.
 * Sequence readers pass false for native flags=0 (one counter); the default
 * permits img2enc's MULTIPLE flag. Other dialects ignore that parameter. */
export function parseFilenameExpression(value: Uint8Array, dialect: FilenameDialect, multipleCounters = true): FilenameExpression {
  const input = byteText(value), tokens: FilenameExpression['tokens'][number][] = [];
  let literal = '', begin = 0, complete = true;
  const flush = (end: number) => { if (literal) tokens.push({ kind: 'literal', value: literal, start: begin, end }); literal = ''; };
  if (dialect === 'dash-resource') {
    // dashdec.c get_content_url performs case-insensitive string replacement
    // for these two exact tags after joining the complete resource URL. This
    // reader does not apply ff_dash_fill_tmpl's counters, formatting or $$.
    const folded = input.toLowerCase();
    for (let i = 0; i < input.length;) {
      const tag = ['$representationid$', '$bandwidth$'].find(tag => folded.startsWith(tag, i));
      if (tag) {
        flush(i);
        tokens.push({ kind: 'template', value: input.slice(i + 1, i + tag.length - 1), start: i, end: i + tag.length });
        i += tag.length;
      } else {
        if (!literal) begin = i;
        literal += input[i++];
      }
    }
    flush(input.length);
    return { dialect, tokens, complete };
  }
  if (dialect === 'hls') {
    let cursor = 0;
    while (cursor < input.length) {
      const start = input.indexOf('{$', cursor);
      const end = start < 0 ? input.length : start;
      if (end > cursor) tokens.push({ kind: 'literal', value: input.slice(cursor, end), start: cursor, end });
      if (start < 0) break;
      const close = input.indexOf('}', start + 2);
      const name = input.slice(start + 2, close < 0 ? input.length : close);
      if (close < 0 || !name || ![...name].every(c => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-'.includes(c))) complete = false;
      tokens.push({ kind: 'property', value: name, start, end: close < 0 ? input.length : close + 1 });
      cursor = close < 0 ? input.length : close + 1;
    }
    return { dialect, tokens, complete };
  }
  const marker = dialect === 'dash' ? '$' : '%';
  for (let i = 0; i < input.length;) {
    if (input[i] !== marker) { if (!literal) begin = i; literal += input[i++]; continue; }
    const start = i++;
    if (input[i] === marker) { if (!literal) begin = start; literal += marker; i++; continue; }
    flush(start);
    if (dialect === 'dash') {
      const end = input.indexOf('$', i);
      if (end < 0) { complete = false; break; }
      const name = input.slice(i, end), percent = name.indexOf('%'), key = percent < 0 ? name : name.slice(0, percent);
      if (!['RepresentationID','Number','Bandwidth','Time'].includes(key)) complete = false;
      if (percent >= 0) {
        const format = name.slice(percent + 1);
        // Registered dash.c accepts exactly %0[width]d, where width is one
        // digit. Unsupported tags remain native literal/fallback decisions.
        if (key === 'RepresentationID' || format.length !== 3 || format[0] !== '0'
          || !'0123456789'.includes(format[1]) || format[2] !== 'd') complete = false;
      }
      tokens.push({ kind: 'template', value: name, start, end: end + 1 }); i = end + 1;
    } else if (dialect === 'imagemagick' && input[i] === '[') {
      const content = ++i;
      let depth = 1;
      while (i < input.length && depth) {
        if (input[i] === '\\' && i + 1 < input.length) { i += 2; continue; }
        if (input[i] === '[') depth++;
        else if (input[i] === ']') depth--;
        i++;
      }
      if (depth) { complete = false; break; }
      tokens.push({ kind: 'property', value: input.slice(content, i - 1), start, end: i });
    } else {
      const digits = i;
      let width = 0;
      while (i < input.length && '0123456789'.includes(input[i])) {
        // Registered utils.c ff_bprint_get_frame_filename guards the width
        // before consuming each digit, including widths before a literal %.
        // Never allocate or expand that width during advisory discovery.
        if (dialect === 'sequence' && width >= Math.floor(2147483647 / 10) - 255) {
          return { dialect, tokens, complete: false };
        }
        if (dialect === 'sequence') width = width * 10 + Number(input[i]);
        i++;
      }
      if (dialect === 'sequence' && input[i] === '%') {
        begin = start;
        literal = '%';
        i++;
        continue;
      }
      if (input[i] === 'd') tokens.push({ kind: 'counter', value: input.slice(digits, i), start, end: ++i });
      else if (dialect === 'imagemagick' && i === digits && i < input.length) tokens.push({ kind: 'property', value: input[i++], start, end: i });
      else { complete = false; if (i < input.length) i++; }
    }
  }
  flush(input.length);
  if (dialect === 'sequence') {
    // img2dec calls the native formatter with flags=0; img2enc permits
    // MULTIPLE. Both readers require at least one counter, even with %%.
    const counters = tokens.filter(token => token.kind === 'counter').length;
    if (!counters || !multipleCounters && counters > 1) complete = false;
  }
  return { dialect, tokens, complete };
}
