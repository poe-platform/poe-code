export interface QuoteGuess {
  readonly quotechar: string;
  readonly doublequote: boolean;
  readonly delimiter: string;
  readonly skipinitialspace: boolean;
}

/** Frozen CPython 3.14.2 heuristics, including their intentionally permissive matches. */
export function guessQuotes(sample: string, step: () => void): QuoteGuess | undefined {
  // Python's Unicode \w includes all letters/numbers and ASCII underscore.
  const delimiterPattern = String.raw`[^${PYTHON_WORD_CLASS}\n"']`;
  // JS multiline anchors also recognize CR/U+2028/U+2029; Python only recognizes LF.
  const start = String.raw`(?:(?<![\s\S])|(?<=\n))`;
  const end = String.raw`(?=\n|(?![\s\S]))`;
  const patterns = [
    String.raw`(?<delim>${delimiterPattern})(?<space> ?)(?<quote>["']).*?\k<quote>\k<delim>`,
    String.raw`(?:${start}|\n)(?<quote>["']).*?\k<quote>(?<delim>${delimiterPattern})(?<space> ?)`,
    String.raw`(?<delim>${delimiterPattern})(?<space> ?)(?<quote>["']).*?\k<quote>(?:${end}|\n)`,
    String.raw`(?:${start}|\n)(?<quote>["']).*?\k<quote>(?:${end}|\n)`
  ];
  const quotes = new Map<string, number>();
  const delimiters = new Map<string, number>();
  let spaces = 0;
  for (const pattern of patterns) {
    step();
    const expression = new RegExp(pattern, "gsu");
    for (;;) {
      step();
      const match = expression.exec(sample);
      if (!match) break;
      const groups = match.groups!;
      const quote = groups.quote!;
      quotes.set(quote, (quotes.get(quote) ?? 0) + 1);
      const delimiter = groups.delim;
      if (delimiter && [",", "\t", ";", " ", ":", "|"].includes(delimiter))
        delimiters.set(delimiter, (delimiters.get(delimiter) ?? 0) + 1);
      if (groups.space) spaces++;
    }
    if (quotes.size) break;
  }
  if (!quotes.size) return undefined;
  let quotechar = "";
  let quoteCount = -1;
  for (const [quote, count] of quotes) {
    step();
    if (count > quoteCount) { quotechar = quote; quoteCount = count; }
  }
  let delimiter = "";
  let delimiterCount = -1;
  for (const [candidate, count] of delimiters) {
    step();
    if (count > delimiterCount) { delimiter = candidate; delimiterCount = count; }
  }
  // Escape for both character-class and ordinary regexp contexts.
  const escapedDelimiter = delimiter.replace(/[\\^$.*+?()[\]{}|-]/gu, "\\$&");
  const nonword = String.raw`[^${PYTHON_WORD_CLASS}]`;
  const doublequotePattern = String.raw`((${escapedDelimiter})|${start})${nonword}*${quotechar}[^${escapedDelimiter}\n]*${quotechar}[^${escapedDelimiter}\n]*${quotechar}${nonword}*((${escapedDelimiter})|${end})`;
  step();
  const doublequote = new RegExp(doublequotePattern, "u").test(sample);
  return { quotechar, delimiter, doublequote, skipinitialspace: delimiterCount === spaces };
}
import { PYTHON_WORD_CLASS } from "./sniffer-unicode.js";
