export const chatOptions: readonly string[] = [
  '-h', '--help', '--td', '--tools-debug', '--ta', '--tools-approve', '--no-stream',
  '--functions', '-T', '--tool', '--cl', '--chain-limit', '-f', '--fragment',
  '--sf', '--system-fragment', '-m', '--model', '-s', '--system', '-o', '--option',
  '-t', '--template', '-p', '--param', '--key'
];

/** Click's three closest long options, using Python's matching-block ratio. */
export async function chatOptionSuggestion(value: string, step: () => Promise<void>): Promise<string> {
  if (!value.startsWith('--')) return '';
  const options = chatOptions.filter(option => option.startsWith('--'));
  const cutoff = 0.6;
  // Even a perfect match of the longest option cannot qualify beyond this size.
  // This also keeps every comparison below SequenceMatcher's autojunk threshold.
  const maximum = Math.floor(Math.max(...options.map(option => option.length)) * (2 / cutoff - 1));
  const input: string[] = [];
  for (const char of value) {
    await step();
    input.push(char);
    if (input.length > maximum) return '';
  }
  const matches: {option: string; score: number}[] = [];
  for (const option of options) {
    if (2 * Math.min(option.length, input.length) / (option.length + input.length) < cutoff) continue;
    const pending: [number, number, number, number][] = [[0, option.length, 0, input.length]];
    let matched = 0;
    while (pending.length) {
      const [aStart, aEnd, bStart, bEnd] = pending.pop()!;
      let bestA = aStart, bestB = bStart, size = 0;
      // Scan earliest option position, then earliest input position, preserving
      // Python's tie breaking when equal-sized matching blocks overlap.
      for (let a = aStart; a < aEnd; a++) {
        await step();
        for (let b = bStart; b < bEnd; b++) {
          let length = 0;
          while (a + length < aEnd && b + length < bEnd && option[a + length] === input[b + length]) length++;
          if (length > size) {bestA = a; bestB = b; size = length;}
        }
      }
      if (!size) continue;
      matched += size;
      if (aStart < bestA && bStart < bestB) pending.push([aStart, bestA, bStart, bestB]);
      if (bestA + size < aEnd && bestB + size < bEnd) pending.push([bestA + size, aEnd, bestB + size, bEnd]);
    }
    const score = 2 * matched / (option.length + input.length);
    if (score >= cutoff) matches.push({option, score});
  }
  matches.sort((left, right) => right.score - left.score || (left.option < right.option ? 1 : left.option > right.option ? -1 : 0));
  const suggestions = matches.slice(0, 3).map(match => match.option).sort();
  return !suggestions.length ? '' : suggestions.length === 1 ? ` Did you mean ${suggestions[0]}?` : ` (Possible options: ${suggestions.join(', ')})`;
}
