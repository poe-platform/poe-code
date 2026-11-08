export function splitSourceLines(source: string): string[] {
  const lines: string[] = [];
  let start = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character !== "\r" && character !== "\n" && character !== "\u2028" && character !== "\u2029") continue;
    lines.push(source.slice(start, index));
    if (character === "\r" && source[index + 1] === "\n") index += 1;
    start = index + 1;
  }
  lines.push(source.slice(start));
  return lines;
}
