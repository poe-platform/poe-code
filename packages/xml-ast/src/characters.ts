export function validCharacter(point: number): boolean {
  return point === 9 || point === 10 || point === 13
    || (point >= 0x20 && point <= 0xd7ff)
    || (point >= 0xe000 && point <= 0xfffd)
    || (point >= 0x10000 && point <= 0x10ffff);
}

/** Validate scalar values and normalize XML line endings in fixed windows. */
export async function* normalizeXmlChunks(source: AsyncIterable<string> | Iterable<string>, flushChunks = false): AsyncGenerator<string> {
  let first = true, afterCR = false, high = 0, output = '';
  for await (const chunk of source) {
    for (let index = 0; index < chunk.length; index++) {
      const code = chunk.charCodeAt(index);
      if (first) { first = false; if (code === 0xfeff) continue; }
      if (high) {
        if (code < 0xdc00 || code > 0xdfff) throw new SyntaxError('Invalid XML: invalid character');
        output += String.fromCharCode(high, code); high = 0;
      } else {
        if (afterCR) { afterCR = false; if (code === 10) continue; }
        if (code >= 0xd800 && code <= 0xdbff) { high = code; continue; }
        if (!validCharacter(code)) throw new SyntaxError('Invalid XML: invalid character');
        afterCR = code === 13;
        output += code === 13 ? '\n' : chunk[index]!;
      }
      if (output.length >= 512) { yield output; output = ''; }
    }
    if (flushChunks && output) { yield output; output = ''; }
  }
  if (high) throw new SyntaxError('Invalid XML: invalid character');
  if (output) yield output;
}
