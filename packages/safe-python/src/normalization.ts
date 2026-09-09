import { combiningClasses, compositions, decompositions } from "./normalization-data.js";

const hangulBase = 0xac00;
const leadingBase = 0x1100;
const vowelBase = 0x1161;
const trailingBase = 0x11a7;
const vowelCount = 21;
const trailingCount = 28;
const syllablesPerLeading = vowelCount * trailingCount;
const syllableCount = 19 * syllablesPerLeading;

/** Unicode 16 NFKC, independent of the host JavaScript engine's Unicode data. */
export function normalizeNfkc(text: string): string {
  const points: number[] = [];
  for (const character of text) decompose(character.codePointAt(0)!, points);
  // Sort each combining sequence stably. Unlike insertion ordering, this avoids
  // quadratic behavior on deliberately reverse-ordered runs of combining marks.
  for (let start = 0; start < points.length;) {
    if (!combiningClasses[points[start]]) { start++; continue; }
    let end = start + 1;
    while (end < points.length && combiningClasses[points[end]]) end++;
    if (end - start > 1) {
      const ordered = points.slice(start, end).sort((a, b) => combiningClasses[a] - combiningClasses[b]);
      for (let index = 0; index < ordered.length; index++) points[start + index] = ordered[index];
    }
    start = end;
  }
  const result: number[] = [];
  let starter = -1;
  let previousClass = 0;
  for (const point of points) {
    const currentClass = combiningClasses[point] ?? 0;
    const composite = starter >= 0 && (previousClass === 0 || previousClass < currentClass)
      ? compose(result[starter], point) : undefined;
    if (composite !== undefined) result[starter] = composite;
    else {
      if (currentClass === 0) starter = result.length;
      result.push(point);
      previousClass = currentClass;
    }
  }
  // Avoid spreading an unbounded number of code points into a host call.
  return result.map(point => String.fromCodePoint(point)).join("");
}

function decompose(point: number, output: number[]): void {
  const syllable = point - hangulBase;
  if (syllable >= 0 && syllable < syllableCount) {
    output.push(leadingBase + Math.floor(syllable / syllablesPerLeading));
    output.push(vowelBase + Math.floor((syllable % syllablesPerLeading) / trailingCount));
    const trailing = syllable % trailingCount;
    if (trailing) output.push(trailingBase + trailing);
    return;
  }
  const decomposition = decompositions[point];
  if (decomposition) for (const child of decomposition) decompose(child, output);
  else output.push(point);
}

function compose(first: number, second: number): number | undefined {
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
  return compositions[first * 0x110000 + second];
}
