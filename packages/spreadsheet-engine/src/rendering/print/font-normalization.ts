// Font-aware canonical diacritics, adapted from HarfBuzz10.2.0.
// See font-normalization-NOTICE.md for scope, source identities and licenses.
import {fontCharacterProperties, fontDecompositions} from './font-normalization-data.js';

const decompositions = new Map(fontDecompositions.map(([point, first, second]) => [point, [first, second] as const]));
const compositions = new Map(fontDecompositions.filter(row => row[3] !== 0).map(([point, first, second]) => [`${first},${second}`, point]));

/** Normalize only the qualified default-shaper Latin/Greek/Cyrillic clusters.
 * Original logical text belongs in ActualText; this result is for glyph shaping. */
export function normalizeFontText(value: string, supported: ReadonlySet<number>, tick: (amount?: number) => void): string {
  tick(value.length);
  const properties = (point: number): readonly [number, number] => {
    let from = 0, to = fontCharacterProperties.length - 1;
    while (from <= to) {
      tick();
      const middle = (from + to) >>> 1, row = fontCharacterProperties[middle]!;
      if (point < row[0]) to = middle - 1;
      else if (point > row[1]) from = middle + 1;
      else return [row[2], row[3]];
    }
    return [0, 0];
  };
  const decompose = (point: number, shortest: boolean): number[] | undefined => {
    tick();
    const pair = decompositions.get(point);
    if (!pair || pair[1] !== 0 && !supported.has(pair[1])) return;
    const [first, second] = pair;
    if (shortest && supported.has(first)) return second === 0 ? [first] : [first, second];
    const nested = decompose(first, shortest);
    if (nested) {if (second !== 0) nested.push(second);return nested;}
    if (supported.has(first)) return second === 0 ? [first] : [first, second];
  };
  const result: string[] = [];
  for (let start = 0; start < value.length;) {
    tick();
    const first = value.codePointAt(start)!, input = [first];
    let end = start + (first > 0xffff ? 2 : 1), eligible = (properties(first)[0] & 2) !== 0;
    let variation = first >= 0xfe00 && first <= 0xfe0f || first >= 0xe0100 && first <= 0xe01ef;
    while (end < value.length) {
      tick();
      const point = value.codePointAt(end)!, flags = properties(point)[0];
      if ((flags & 1) === 0) break;
      eligible &&= (flags & 4) !== 0;
      variation ||= point >= 0xfe00 && point <= 0xfe0f || point >= 0xe0100 && point <= 0xe01ef;
      input.push(point);
      end += point > 0xffff ? 2 : 1;
    }
    if (!eligible) result.push(value.slice(start, end));
    else {
      const points: {point: number; mark: boolean; ccc: number}[] = [];
      for (const point of input) {
        tick();
        const expanded = variation || input.length === 1 && supported.has(point) ? [point] : decompose(point, input.length === 1) ?? [point];
        for (const child of expanded) {
          const [flags, ccc] = properties(child);
          points.push({point: child, mark: (flags & 1) !== 0, ccc});
        }
      }
      for (let at = 0; at < points.length; at++) {
        tick();
        if (points[at]!.ccc === 0) continue;
        let end = at + 1;
        while (end < points.length && points[end]!.ccc !== 0) {tick();end++;}
        // HarfBuzz's default shaper bounds mark reordering to32characters.
        if (end - at <= 32) {
          const sorted = points.slice(at, end).sort((left, right) => {tick();return left.ccc - right.ccc;});
          for (let index = 0; index < sorted.length; index++) {tick();points[at + index] = sorted[index]!;}
        }
        at = end - 1;
      }
      const output: typeof points = [];
      let starter = 0;
      for (const point of points) {
        tick();
        const combined = point.mark && output[starter] && (starter === output.length - 1 || output[output.length - 1]!.ccc < point.ccc)
          ? compositions.get(`${output[starter]!.point},${point.point}`) : undefined;
        if (combined !== undefined && supported.has(combined)) {
          const [flags, ccc] = properties(combined);
          output[starter] = {point: combined, mark: (flags & 1) !== 0, ccc};
        } else {
          output.push(point);
          if (point.ccc === 0) starter = output.length - 1;
        }
      }
      for (const point of output) {tick();result.push(String.fromCodePoint(point.point));}
    }
    start = end;
  }
  tick();
  return result.join('');
}
