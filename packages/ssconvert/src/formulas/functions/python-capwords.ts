import { rendered } from "../values.js";
import { SsconvertError } from "../../contracts.js";
import { boundedText, scalarArg } from "./common.js";
import { simpleUnicodeCase } from "./unicode.js";
import { cased, caseIgnorable, whitespace, titleDeltas, lowerDeltas } from "./python-capwords-profile.js";
import { inUnicodeRanges as within, type PythonUnicodeProfile } from "./python-unicode-profile.js";
import type { FunctionHost, Value } from "./types.js";
import type { CellValue } from "../../workbook.js";

/** Python string.capwords: whitespace words, full initial titlecase and contextual lowercase. */
export function pythonCapwords(profile: PythonUnicodeProfile, args: readonly (Value | undefined)[], host: FunctionHost): CellValue {
  const value = scalarArg(args, 0, host);
  if (value.kind === "error") return value;
  if (value.kind !== "string" && value.kind !== "byte-string") {
    const type = value.kind === "boolean" ? "bool" : value.kind === "number" ? "float" : "NoneType";
    return { kind: "error", value: `Python exception (<class 'AttributeError'>: '${type}' object has no attribute 'split')` };
  }
  const source = rendered(value), output: string[] = [];
  const isCased = (code: number) => !within(code, profile.uncased) && within(code, cased);
  const isIgnorable = (code: number) => within(code, profile.ignorable) || !within(code, profile.notIgnorable) && within(code, caseIgnorable);
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
      if (!isIgnorable(code)) nextCased = isCased(code);
    }
    let previousCased = false;
    for (let i = 0; i < word.length; i++) {
      host.tick();
      const code = word[i]!;
      emit(i === 0 ? within(code, profile.titleIdentity) ? String.fromCodePoint(code) : titleDeltas.get(code) ?? simpleUnicodeCase(code, true) :
        code === 0x3a3 ? previousCased && !following[i] ? "ς" : "σ" :
          within(code, profile.lowerIdentity) ? String.fromCodePoint(code) : lowerDeltas.get(code) ?? simpleUnicodeCase(code, false));
      if (!isIgnorable(code)) previousCased = isCased(code);
    }
    word = [];
  };
  for (const char of source) {
    host.tick();
    const code = char.codePointAt(0)!;
    if (code === 0) break;
    if (code >= 0xd800 && code <= 0xdfff)
      throw new SsconvertError("unsupported-feature", "Malformed host UTF-16 has no lossless text byte representation");
    if (within(code, whitespace)) flush();
    else word.push(code);
  }
  flush();
  return boundedText(output.join(""), host);
}
