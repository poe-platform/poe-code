/** Native Pango hard breaks; CRLF is one break and empty lines retain height. */
export function splitPrintLines(value: string, tick: (amount?: number) => void): readonly string[] {
  const lines: string[] = [];
  let start = 0;
  for (let at = 0; at < value.length; at++) {
    tick();
    const char = value.charCodeAt(at);
    if (char !== 10 && char !== 13 && char !== 0x2028 && char !== 0x2029) continue;
    lines.push(value.slice(start, at));
    // A line separator finishes the current line, but does not create an
    // empty line at the end of a paragraph (unlike a paragraph delimiter).
    const next = value.charCodeAt(at + 1);
    if (char === 0x2028 && (next === 10 || next === 13 || next === 0x2029)) { tick(); at++; }
    if (value.charCodeAt(at) === 13 && value.charCodeAt(at + 1) === 10) { tick(); at++; }
    start = at + 1;
  }
  if (!value.endsWith("\u2028")) lines.push(value.slice(start));
  return lines;
}
