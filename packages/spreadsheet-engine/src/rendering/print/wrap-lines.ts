import LineBreaker from "linebreak";
import {unhyphenatedScripts} from "./hyphen-scripts.js";

/** Word wrapping with grapheme fallback, matching Pango's WORD_CHAR policy. */
export function wrapPrintLine(value: string, width: number, measure: (text: string) => number,
  tick: (amount?: number) => void): readonly {text: string; hyphen: boolean}[] {
  tick(value.length);
  if (!value || measure(value) <= width) return [{text: value, hyphen: false}];
  const legal = new Set<number>(), breaker = new LineBreaker(value);
  for (let boundary = breaker.nextBreak(); boundary; boundary = breaker.nextBreak()) {
    tick();
    legal.add(boundary.position);
  }
  const hyphenPositions = new Set<number>();
  const words = Array.from(new Intl.Segmenter("und", {granularity: "word"}).segment(value));
  for (const word of words) {
    tick(word.segment.length);
    if (!word.isWordLike) continue;
    let at = word.index;
    for (const character of word.segment) {
      tick();
      at += character.length;
      if (at === word.index + word.segment.length) break;
      const point = character.codePointAt(0)!;
      let low = 0, high = unhyphenatedScripts.length - 1, excluded = false;
      while (low <= high) {
        tick();
        const mid = (low + high) >>> 1, range = unhyphenatedScripts[mid]!;
        if (point < range[0]) high = mid - 1;
        else if (point > range[1]) low = mid + 1;
        else {excluded = true; break;}
      }
      if (!excluded) hyphenPositions.add(at);
    }
  }
  const boundaries = [0];
  for (const part of new Intl.Segmenter("und", {granularity: "grapheme"}).segment(value)) {
    tick();
    boundaries.push(part.index + part.segment.length);
  }
  const lines: {text: string; hyphen: boolean}[] = [];
  let start = 0;
  const trim = (end: number) => {
    while (end > boundaries[start]! && value[end - 1] === " ") {tick(); end--;}
    return end;
  };
  while (start < boundaries.length - 1) {
    let fit = start, word = start;
    for (let at = start + 1; at < boundaries.length; at++) {
      tick();
      const end = boundaries[at]!;
      const candidate = value.slice(boundaries[start], trim(end));
      const measured = end < value.length && candidate.endsWith("­") ? candidate.slice(0, -1) + "‐" : candidate;
      if (measure(measured) > width) break;
      fit = at;
      if (legal.has(end)) word = at;
    }
    let end = fit === boundaries.length - 1 ? fit : word > start ? word : Math.max(start + 1, fit);
    const soft = value[boundaries[end]! - 1] === "­";
    const hyphen = end < boundaries.length - 1 && (soft || !legal.has(boundaries[end]!) && hyphenPositions.has(boundaries[end]!));
    if (hyphen && !soft) while (end > start + 1 && measure(value.slice(boundaries[start], boundaries[end]) + "‐") > width) {tick(); end--;}
    lines.push({text: value.slice(boundaries[start], trim(boundaries[end]!)), hyphen});
    start = end;
    while (start < boundaries.length - 1 && value.slice(boundaries[start], boundaries[start + 1]) === " ") {tick(); start++;}
  }
  return lines;
}
