import { SsconvertError } from "../../contracts.js";
import { boundedText, textArg } from "./common.js";
import { simpleUnicodeCase } from "./unicode.js";
import { cased, caseIgnorable, whitespace, titleDeltas, lowerDeltas } from "./python-capwords-profile.js";
import type { FunctionHost, Value } from "./types.js";
import type { CellValue } from "../../workbook.js";

function within(code: number, ranges: readonly (readonly [number, number])[]): boolean {
  let lo = 0, hi = ranges.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1, range = ranges[mid]!;
    if (code < range[0]) hi = mid;
    else if (code > range[1]) lo = mid + 1;
    else return true;
  }
  return false;
}

/** Python string.capwords: whitespace words, full initial titlecase and contextual lowercase. */
export function pythonCapwords(args: readonly (Value | undefined)[], host: FunctionHost): CellValue {
  const source = textArg(args, 0, host), output: string[] = [];
  let word: number[] = [], bytes = 0;
  const emit = (text: string) => {
    for (const char of text) {
      const code = char.codePointAt(0)!;
      bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
    }
    if (bytes > host.context.limits.outputBytes)
      throw new SsconvertError("resource-limit", "ssconvert calculation text limit exceeded");
    output.push(text);
  };
  const flush = () => {
    if (!word.length) return;
    if (output.length) emit(" ");
    // Determine suffix context once; repeated scans across combining marks would be quadratic.
    const following: boolean[] = [];
    let nextCased = false;
    for (let i = word.length - 1; i >= 0; i--) {
      host.tick();
      const code = word[i]!;
      following[i] = nextCased;
      if (!within(code, caseIgnorable)) nextCased = within(code, cased);
    }
    let previousCased = false;
    for (let i = 0; i < word.length; i++) {
      host.tick();
      const code = word[i]!;
      emit(i === 0 ? titleDeltas.get(code) ?? simpleUnicodeCase(code, true) :
        code === 0x3a3 ? previousCased && !following[i] ? "ς" : "σ" :
          lowerDeltas.get(code) ?? simpleUnicodeCase(code, false));
      if (!within(code, caseIgnorable)) previousCased = within(code, cased);
    }
    word = [];
  };
  for (const char of source) {
    host.tick();
    const code = char.codePointAt(0)!;
    if (within(code, whitespace)) flush();
    else word.push(code);
  }
  flush();
  return boundedText(output.join(""), host);
}
