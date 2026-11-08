import type { PlaywrightPage } from './adapter.js';

/** Search snippets preserve their ancestor path and three lines of nearby context. */
export async function findPlaywrightSnapshot(snapshot: string, options: { text?: string; regex?: string; page?: PlaywrightPage }): Promise<string> {
  if (!options.text && !options.regex) throw new Error('Provide either "text" or "regex" to search for.');
  if (options.text && options.regex) throw new Error('Provide only one of "text" or "regex", not both.');
  const lines = snapshot.split('\n');
  let query: string;
  let matches: boolean[];
  if (options.regex) {
    if (!options.page?.evaluate) throw new Error('Browser regular expression evaluation unavailable');
    const result = await options.page.evaluate(({ lines, pattern }) => {
      const slash = pattern.startsWith('/') ? pattern.lastIndexOf('/') : -1;
      const expression = slash > 0 ? new RegExp(pattern.slice(1, slash), pattern.slice(slash + 1)) : new RegExp(pattern);
      return { query: String(expression), matches: lines.map(line => { expression.lastIndex = 0; return expression.test(line); }) };
    }, { lines, pattern: options.regex });
    query = result.query; matches = result.matches;
  } else {
    query = `"${options.text}"`;
    const needle = options.text!.toLowerCase();
    matches = lines.map(line => line.toLowerCase().includes(needle));
  }
  const matched = matches.flatMap((match, index) => match ? [index] : []);
  if (!matched.length) return `No matches found for ${query}.`;
  const indents = lines.map(line => line.length - line.trimStart().length);
  const ancestors = (index: number): number[] => {
    const result: number[] = [];
    let indent = indents[index]!;
    for (let previous = index - 1; previous >= 0; previous--) if (lines[previous]!.trim() && indents[previous]! < indent) {
      result.push(previous); indent = indents[previous]!;
    }
    return result.reverse();
  };
  const windows: { start: number; end: number }[] = [];
  const paths = new Set<number>();
  for (const index of matched) {
    paths.add(index); for (const ancestor of ancestors(index)) paths.add(ancestor);
    const start = Math.max(0, index - 3), end = Math.min(lines.length - 1, index + 3);
    const previous = windows.at(-1);
    if (previous && start <= previous.end + 1) previous.end = Math.max(previous.end, end);
    else windows.push({ start, end });
  }
  const snippets = windows.map(window => {
    const indices = ancestors(window.start);
    for (let index = window.start; index <= window.end; index++) indices.push(index);
    const output: string[] = [];
    for (let offset = 0; offset < indices.length; offset++) {
      const index = indices[offset]!, previous = indices[offset - 1];
      if (previous !== undefined && index > previous + 1 && !paths.has(index) && !paths.has(previous)) output.push(' '.repeat(indents[index]!) + '...');
      output.push(lines[index]!);
    }
    return output.join('\n');
  });
  return `Found ${matched.length} ${matched.length === 1 ? 'match' : 'matches'} for ${query}:\n\n${snippets.join('\n\n----\n\n')}`;
}
