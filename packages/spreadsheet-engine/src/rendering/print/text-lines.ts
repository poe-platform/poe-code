/** Native Pango hard breaks; CRLF is one break and empty lines retain height. */
export function splitPrintLines(value: string, tick: (amount?: number) => void): readonly {text: string; forced: boolean}[] {
  const lines: {text: string; forced: boolean}[] = [];
  let start = 0;
  for (let at = 0; at < value.length; at++) {
    tick();
    const char = value.charCodeAt(at);
    if (char !== 10 && char !== 13 && char !== 0x2028 && char !== 0x2029) continue;
    lines.push({text: value.slice(start, at), forced: char === 0x2028});
    // A line separator finishes the current line, but does not create an
    // empty line at the end of a paragraph (unlike a paragraph delimiter).
    const next = value.charCodeAt(at + 1);
    if (char === 0x2028 && (next === 10 || next === 13 || next === 0x2029)) { tick(); at++; }
    if (value.charCodeAt(at) === 13 && value.charCodeAt(at + 1) === 10) { tick(); at++; }
    start = at + 1;
  }
  if (!value.endsWith("\u2028")) lines.push({text: value.slice(start), forced: false});
  return lines;
}

/** Gnumeric displays LF inside Fill strings as a direction-aware return arrow. */
export function fillPrintNewlines(value: string, rtl: boolean, tick: (amount?: number) => void): string {
  tick(value.length);
  return value.split("\n").join(rtl ? "↪" : "↩");
}

/** Keep shaping boundaries and control markers in single-direction Fill visual order. */
export function fillPrintItems(value: string, rtl: boolean, tick: (amount?: number) => void): string[] {
  tick(value.length);
  const parts = value.split("\u2029").flatMap(part => ["\u2028", "\r"].reduce(
    (parts, separator) => parts.flatMap(part => part.split(separator).flatMap((piece, index) => index ? [separator, piece] : [piece])), [part]));
  return rtl ? parts.reverse() : parts;
}
