import { POSSIBLE_DELIMITERS, type SniffedCsvDialect } from "safe-bash-csv-engine/sniffer";
import { PYTHON_WORD_CLASS } from "../csv/sniffer-unicode.js";
import { externalSort, type RowStorage } from "../table/external.js";

const word = new RegExp(`[${PYTHON_WORD_CLASS}]`, "u");
const delimiterCharacter = (char: string | undefined): char is string => char !== undefined && char !== "\n" && char !== '"' && char !== "'" && !word.test(char);
const quoteCharacter = (char: string | undefined): char is string => char === '"' || char === "'";
type TextSource = () => AsyncIterable<string>;

/** A replayable cursor keeps three codepoints, not a sample-sized string. */
class Cursor {
  readonly iterator: AsyncIterator<string>;
  readonly pending: string[] = [];
  position = 0;
  previous: string | undefined;
  constructor(source: TextSource, readonly step: () => void) {
    this.iterator = (async function* () { for await (const chunk of source()) yield* chunk; })()[Symbol.asyncIterator]();
  }
  async peek(offset = 0): Promise<string | undefined> {
    while (this.pending.length <= offset) {
      const next = await this.iterator.next();
      if (next.done) return undefined;
      this.pending.push(next.value);
    }
    return this.pending[offset];
  }
  async advance(): Promise<string | undefined> {
    const value = await this.peek();
    if (value !== undefined) { this.step(); this.pending.shift(); this.position++; this.previous = value; }
    return value;
  }
  async skip(position: number): Promise<void> { while (this.position < position && await this.advance() !== undefined) { /* replay to a regex backtrack position */ } }
  async close(): Promise<void> { await this.iterator.return?.(); }
}

async function quotes(source: TextSource, step: () => void) {
  let hasQuote = false;
  for await (const chunk of source()) { step(); if (chunk.includes('"') || chunk.includes("'")) { hasQuote = true; break; } }
  if (!hasQuote) return undefined;
  const quoteCounts = new Map<string, number>(), delimiterCounts = new Map<string, number>();
  let spaces = 0;
  // The four source regexes differ only in their prefix/suffix assertions.
  // Replaying a failed candidate preserves leftmost/non-greedy matching without
  // retaining text. Pathological backtracking remains charged to the work budget.
  for (let pattern = 0; pattern < 4; pattern++) {
    let cursor = new Cursor(source, step);
    try {
      while (await cursor.peek() !== undefined) {
        const start = cursor.position, char = await cursor.peek();
        let delimiter: string | undefined, space = false, quote: string | undefined;
        if (pattern === 0 || pattern === 2) {
          if (delimiterCharacter(char)) {
            delimiter = char;
            let offset = 1;
            if (await cursor.peek(offset) === " ") { space = true; offset++; }
            const candidate = await cursor.peek(offset);
            if (quoteCharacter(candidate)) { quote = candidate; for (let n = 0; n <= offset; n++) await cursor.advance(); }
          }
        } else {
          const anchored = start === 0 || cursor.previous === "\n";
          const candidate = char === "\n" ? await cursor.peek(1) : anchored ? char : undefined;
          if (quoteCharacter(candidate)) { quote = candidate; if (char === "\n") await cursor.advance(); await cursor.advance(); }
        }
        if (!quote) { await cursor.advance(); continue; }
        let matched = false;
        while (await cursor.peek() !== undefined) {
          const value = await cursor.advance();
          if (value !== quote) continue;
          const following = await cursor.peek();
          if (pattern === 0 && following === delimiter) { await cursor.advance(); matched = true; }
          else if (pattern === 1 && delimiterCharacter(following)) {
            delimiter = await cursor.advance(); space = await cursor.peek() === " ";
            if (space) await cursor.advance();
            matched = true;
          } else if ((pattern === 2 || pattern === 3) && (following === undefined || following === "\n")) matched = true;
          if (matched) break;
        }
        if (matched) {
          quoteCounts.set(quote, (quoteCounts.get(quote) ?? 0) + 1);
          if (delimiter && POSSIBLE_DELIMITERS.includes(delimiter)) delimiterCounts.set(delimiter, (delimiterCounts.get(delimiter) ?? 0) + 1);
          if (space) spaces++;
        } else {
          await cursor.close(); cursor = new Cursor(source, step); await cursor.skip(start + 1);
        }
      }
    } finally { await cursor.close(); }
    if (quoteCounts.size) break;
  }
  if (!quoteCounts.size) return undefined;
  const best = (counts: ReadonlyMap<string, number>): string => {
    let selected = "", count = -1;
    for (const [key, value] of counts) if (value > count) { selected = key; count = value; }
    return selected;
  };
  const quotechar = best(quoteCounts), delimiter = best(delimiterCounts);
  // Boolean NFA for the source doublequote regex; greedy choices have no effect
  // on whether a match exists. All four active states occupy constant memory.
  let prefix = false, first = false, second = false, suffix = false, previous: string | undefined;
  let doublequote = false, atStart = true;
  outer: for await (const chunk of source()) for (const char of chunk) {
    step();
    if (suffix && (!delimiter || char === "\n" || char === delimiter)) { doublequote = true; break outer; }
    if (!delimiter || atStart || previous === "\n") prefix = true;
    const nonword = !word.test(char), middle = char !== "\n" && char !== delimiter;
    const nextSuffix: boolean = suffix && nonword || second && char === quotechar;
    second = second && middle || first && char === quotechar;
    first = first && middle || prefix && char === quotechar;
    prefix = prefix && nonword || char === delimiter;
    suffix = nextSuffix; previous = char; atStart = false;
  }
  if (suffix) doublequote = true;
  return { quotechar, delimiter, doublequote, skipinitialspace: (delimiterCounts.get(delimiter) ?? -1) === spaces };
}

/** Full-sample CPython csvkit sniffing over replay storage. Histograms spill too. */
export async function sniffReplay(source: TextSource, storage: RowStorage, step: () => void): Promise<SniffedCsvDialect | undefined> {
  const quoted = await quotes(source, step);
  let delimiter = quoted?.delimiter;
  let skipinitialspace = quoted?.skipinitialspace ?? false;
  if (!delimiter) {
    const allowed = [...POSSIBLE_DELIMITERS].sort();
    const firstSpaces = allowed.map(() => 0), firstCounts = allowed.map(() => 0);
    let total = 0;
    async function* counts(limit = Infinity) {
      let frequencies = allowed.map(() => 0), length = 0, line = 0, previous: string | undefined;
      for await (const chunk of source()) for (const char of chunk) {
        step();
        if (char === "\n") {
          if (length) {
            for (let index = 0; index < allowed.length; index++) yield { delimiter: index, frequency: frequencies[index]!, line };
            if (++line === limit) return;
          }
          frequencies = allowed.map(() => 0); length = 0; previous = undefined;
        } else {
          length++;
          for (let index = 0; index < allowed.length; index++) {
            if (char === allowed[index]) frequencies[index]!++;
            if (!line) {
              if (char === allowed[index]) firstCounts[index]!++;
              if (previous === allowed[index] && char === " ") firstSpaces[index]!++;
            }
          }
          previous = char;
        }
      }
      if (length) for (let index = 0; index < allowed.length; index++) yield { delimiter: index, frequency: frequencies[index]!, line };
    }
    // Determine the reference's final partial-chunk denominator first.
    for await (const item of counts()) if (!item.delimiter) total++;
    const spaces = [...firstSpaces], initial = [...firstCounts];
    const chunkLength = Math.min(10, total);
    const candidates = new Map<string, readonly [number, number]>();
    for (let end = chunkLength; total && end <= total + chunkLength - 1; end += chunkLength) {
      const size = Math.min(end, total);
      const ordered = await externalSort(storage, counts(size), (a, b) => a.delimiter - b.delimiter || a.frequency - b.frequency, step);
      const modes = allowed.map(() => ({ frequency: 0, count: 0, first: Infinity, groups: 0 }));
      let group: { delimiter: number; frequency: number; count: number; first: number } | undefined;
      const finish = () => {
        if (!group) return;
        const mode = modes[group.delimiter]!; mode.groups++;
        if (group.count > mode.count || group.count === mode.count && group.first < mode.first) Object.assign(mode, { frequency: group.frequency, count: group.count, first: group.first });
      };
      try {
        for await (const item of ordered.read()) {
          if (group && group.delimiter === item.delimiter && group.frequency === item.frequency) group.count++;
          else { finish(); group = { delimiter: item.delimiter, frequency: item.frequency, count: 1, first: item.line }; }
        }
        finish();
      } finally { await ordered.close(); }
      for (let consistency = 1; !candidates.size && consistency >= 0.9; consistency -= 0.01) for (let index = 0; index < allowed.length; index++) {
        step();
        const mode = modes[index]!, score = mode.count * 2 - size;
        if (mode.frequency > 0 && score > 0 && score / size >= consistency) candidates.set(allowed[index]!, [mode.frequency, score]);
      }
      // Once nonempty the source never changes its candidate map again.
      if (candidates.size) break;
    }
    delimiter = POSSIBLE_DELIMITERS.find(char => candidates.has(char));
    if (!delimiter) return undefined;
    const index = allowed.indexOf(delimiter);
    skipinitialspace = initial[index] === spaces[index];
  }
  return { delimiter, quotechar: quoted?.quotechar || '"', doublequote: quoted?.doublequote ?? false, skipinitialspace, quoting: 0, lineterminator: "\r\n" };
}
