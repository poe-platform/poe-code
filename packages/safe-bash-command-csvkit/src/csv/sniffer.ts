import type { CsvDialect } from "../csv.js";
import { guessQuotes } from "./sniffer-quotes.js";

export const POSSIBLE_DELIMITERS = Object.freeze([",", "\t", ";", " ", ":", "|"]);

/** Frozen CPython 3.14.2 frequency modes (including floating threshold rounding). */
export function sniff(sample: string, step: () => void = () => {}): CsvDialect | undefined {
  const quoted = guessQuotes(sample, step);
  let delimiter = quoted?.delimiter;
  let skipinitialspace = quoted?.skipinitialspace ?? false;
  if (!delimiter) {
    const lines = sample.split("\n").filter(Boolean);
    const chunkLength = Math.min(10, lines.length);
    const frequencies = new Map<string, Map<number, number>>();
    const candidates = new Map<string, readonly [number, number]>();
    const count = (line: string, char: string): number => {
      let total = 0;
      for (let index = 0; index < line.length; index++) { step(); if (line[index] === char) total++; }
      return total;
    };
    for (let start = 0, iteration = 1; start < lines.length; start += chunkLength, iteration++) {
      for (const line of lines.slice(start, start + chunkLength)) {
        // Only admitted delimiter modes can affect the returned result.
        for (const char of [...POSSIBLE_DELIMITERS].sort()) {
          const frequency = count(line, char);
          const meta = frequencies.get(char) ?? new Map<number, number>();
          meta.set(frequency, (meta.get(frequency) ?? 0) + 1);
          frequencies.set(char, meta);
        }
      }
      const modes = new Map<string, readonly [number, number]>();
      for (const [char, meta] of frequencies) {
        let best: readonly [number, number] = [0, 0];
        let total = 0;
        for (const entry of meta) { step(); total += entry[1]; if (entry[1] > best[1]) best = entry; }
        if (meta.size === 1 && best[0] === 0) continue;
        modes.set(char, [best[0], best[1] * 2 - total]);
      }
      const total = Math.min(chunkLength * iteration, lines.length);
      for (let consistency = 1; !candidates.size && consistency >= 0.9; consistency -= 0.01) {
        for (const [char, mode] of modes) {
          step();
          if (mode[0] > 0 && mode[1] > 0 && mode[1] / total >= consistency) candidates.set(char, mode);
        }
      }
      if (candidates.size === 1) break;
    }
    delimiter = POSSIBLE_DELIMITERS.find(char => candidates.has(char));
    if (!delimiter) return undefined;
    const first = lines[0]!;
    let spaces = 0;
    for (let index = 0; index < first.length - 1; index++) {
      step(); if (first[index] === delimiter && first[index + 1] === " ") spaces++;
    }
    skipinitialspace = count(first, delimiter) === spaces;
  }
  return { delimiter, quotechar: quoted?.quotechar || '"', doublequote: quoted?.doublequote ?? false,
    skipinitialspace, quoting: 0, lineterminator: "\r\n" };
}
