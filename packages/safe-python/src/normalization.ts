import { combiningClasses, compositions, decompositions } from "./normalization-data.js";
import type {SourceMeter} from "./source.js";
import {ExecutionLimitError} from "./runtime/execution-budget.js";

const hangulBase = 0xac00;
const leadingBase = 0x1100;
const vowelBase = 0x1161;
const trailingBase = 0x11a7;
const vowelCount = 21;
const trailingCount = 28;
const syllablesPerLeading = vowelCount * trailingCount;
const syllableCount = 19 * syllablesPerLeading;

export interface NormalizationTables {
  readonly decompositions: Readonly<Record<number, readonly number[]>>;
  readonly combiningClasses: Readonly<Record<number, number>>;
  readonly compositions: Readonly<Record<number, number>>;
}

const unicode16Normalization: NormalizationTables = {decompositions, combiningClasses, compositions};

/** Unicode 16 NFKC, independent of the host JavaScript engine's Unicode data. */
export function normalizeNfkc(text: string,meter?:SourceMeter): string {
  // Source identifiers arrive as host text. Guest strings use the code-point
  // entry point below so adjacent surrogate points never become one scalar.
  const input = function* () {for (const character of text) yield character.codePointAt(0)!;};
  const result = normalizeNfkcPoints(input(), unicode16Normalization, meter);
  // Avoid spreading an unbounded number of code points into a host call.
  meter?.checkpoint(0,32);const parts:string[]=[];let length=0;
  for(const point of result){
    const width=point>0xffff?2:1;meter?.checkpoint(1,8+2*width);
    parts.push(String.fromCodePoint(point));length+=width;
  }
  meter?.checkpoint(0,2*length);return parts.join("");
}

/** NFKC over validated Python code points with explicit pinned properties.
 * Returns owned storage; the tables never depend on the host Unicode version. */
export function normalizeNfkcPoints(input: Iterable<number>, tables: NormalizationTables, meter?: SourceMeter): number[] {
  meter?.checkpoint(1,32);
  let fatal = false;
  try {
  const {combiningClasses} = tables;
  const points: number[] = [];
  for (const point of input) {meter?.checkpoint();decompose(point, points,tables,meter);}
  // Sort each combining sequence stably. Unlike insertion ordering, this avoids
  // quadratic behavior on deliberately reverse-ordered runs of combining marks.
  for (let start = 0; start < points.length;) {
    meter?.checkpoint();
    if (!combiningClasses[points[start]]) { start++; continue; }
    let end = start + 1;
    while (end < points.length && combiningClasses[points[end]]) {meter?.checkpoint();end++;}
    if (end - start > 1) {
      meter?.checkpoint(0,64+16*(end-start));
      const ordered = points.slice(start, end).sort((a, b) => {meter?.checkpoint();return combiningClasses[a] - combiningClasses[b];});
      for (let index = 0; index < ordered.length; index++) {meter?.checkpoint();points[start + index] = ordered[index];}
    }
    start = end;
  }
  meter?.checkpoint(0,32);const result: number[] = [];
  let starter = -1;
  let previousClass = 0;
  for (const point of points) {
    meter?.checkpoint();
    const currentClass = combiningClasses[point] ?? 0;
    const composite = starter >= 0 && (previousClass === 0 || previousClass < currentClass)
      ? compose(result[starter], point, tables) : undefined;
    if (composite !== undefined) result[starter] = composite;
    else {
      if (currentClass === 0) starter = result.length;
      meter?.checkpoint(0,8);result.push(point);
      previousClass = currentClass;
    }
  }
  return result;
  } catch (error) {fatal = error instanceof ExecutionLimitError;throw error;}
  finally {if (!fatal) meter?.checkpoint();}
}

function decompose(point: number, output: number[],tables: NormalizationTables,meter?:SourceMeter): void {
  meter?.checkpoint();
  const syllable = point - hangulBase;
  if (syllable >= 0 && syllable < syllableCount) {
    meter?.checkpoint(0,24);
    output.push(leadingBase + Math.floor(syllable / syllablesPerLeading));
    output.push(vowelBase + Math.floor((syllable % syllablesPerLeading) / trailingCount));
    const trailing = syllable % trailingCount;
    if (trailing) output.push(trailingBase + trailing);
    return;
  }
  const decomposition = tables.decompositions[point];
  if (decomposition) for (const child of decomposition) decompose(child, output,tables,meter);
  else {meter?.checkpoint(0,8);output.push(point);}
}

function compose(first: number, second: number, tables: NormalizationTables): number | undefined {
  const leading = first - leadingBase;
  const vowel = second - vowelBase;
  if (leading >= 0 && leading < 19 && vowel >= 0 && vowel < vowelCount) {
    return hangulBase + (leading * vowelCount + vowel) * trailingCount;
  }
  const syllable = first - hangulBase;
  const trailing = second - trailingBase;
  if (syllable >= 0 && syllable < syllableCount && syllable % trailingCount === 0 && trailing > 0 && trailing < trailingCount) {
    return first + trailing;
  }
  return tables.compositions[first * 0x110000 + second];
}
