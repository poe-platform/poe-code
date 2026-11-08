import {PublicDiagnostic} from 'safe-bash-contracts/public-diagnostic';
import {Pattern,type PatternLimits} from './text/regex.js';

/** Python 3.9 fnmatch syntax for one filename component. Matching uses the
 * existing Unicode regex kernel and its cooperative work/allocation budget. */
export function compilePythonGlob(source: string, limits: PatternLimits = {}): Pattern {
  const sourceLimit = limits.maxPatternSource ?? Infinity;
  if (sourceLimit !== Infinity && (!Number.isSafeInteger(sourceLimit) || sourceLimit < 1)) throw new PublicDiagnostic('glob source limit must be a positive safe integer');
  if (source.length > sourceLimit) throw new PublicDiagnostic('glob source limit exceeded');
  let translated = '\\A';
  for (let offset = 0; offset < source.length; offset++) {
    const character = source[offset]!;
    if (character === '*') {
      while (source[offset + 1] === '*') offset++;
      translated += '.*';
    } else if (character === '?') translated += '.';
    else if (character === '[') {
      let end = offset + 1;
      if (source[end] === '!') end++;
      if (source[end] === ']') end++;
      while (end < source.length && source[end] !== ']') end++;
      if (end === source.length) { translated += '\\['; continue; }
      const contents = source.slice(offset + 1, end);
      let escaped: string;
      if (contents.includes('--')) {
        const chunks: string[] = []; let start = 0, cursor = contents[0] === '!' ? 2 : 1;
        while (true) {
          const dash = contents.indexOf('-', cursor);
          if (dash < 0) break;
          chunks.push(contents.slice(start, dash)); start = dash + 1; cursor = dash + 3;
        }
        chunks.push(contents.slice(start));
        escaped = chunks.map(chunk => chunk.replaceAll('\\', '\\\\').replaceAll('-', '\\-')).join('-');
      } else escaped = contents.replaceAll('\\', '\\\\');
      escaped = escaped.replaceAll('&', '\\&').replaceAll('~', '\\~').replaceAll('|', '\\|').replaceAll('[', '\\[').replaceAll(']', '\\]');
      if (escaped[0] === '!') escaped = '^' + escaped.slice(1);
      else if (escaped[0] === '^') escaped = '\\' + escaped;
      translated += '[' + escaped + ']'; offset = end;
    } else translated += '\\.^$+{}[]()|'.includes(character) ? '\\' + character : character;
  }
  translated += '\\z';
  // Source admission applies to the caller's glob. Escaping expansion is bounded
  // by that admitted input; the kernel independently enforces program/depth limits.
  return new Pattern('(?s:' + translated + ')', true, false, 'rust', '', {
    ...limits, maxPatternSource: Math.max(1, translated.length + 5)
  });
}
