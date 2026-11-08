import createBidi, {type Bidi} from "bidi-js";

// The CommonJS factory is published with an ESM-shaped declaration.
const bidi = (createBidi as unknown as () => Bidi)();

/** Visual run order with logical text retained for the font shaper. */
export function printBidiRuns(text: string, direction: "ltr" | "rtl", tick: (amount?: number) => void): {text: string; direction: "ltr" | "rtl"}[] {
  // UAX #9 caps embedding depth at 125; reserve synchronous resolver work.
  tick(text.length * 128);
  if (!text) return [];
  const embedding = bidi.getEmbeddingLevels(text, direction);
  const groups: {text: string; direction: "ltr" | "rtl"}[] = [];
  const membership: number[] = [];
  let previous = -1;
  for (let index = 0; index < text.length; index++) {
    tick();
    const level = embedding.levels[index]!;
    if (level !== previous) {
      groups.push({text: "", direction: level % 2 ? "rtl" : "ltr"});
      previous = level;
    }
    groups[groups.length - 1]!.text += text[index]!;
    membership.push(groups.length - 1);
  }
  const seen = new Set<number>();
  const result: typeof groups = [];
  for (const index of bidi.getReorderedIndices(text, embedding)) {
    tick();
    const group = membership[index]!;
    if (!seen.has(group)) {seen.add(group); result.push(groups[group]!);}
  }
  return result;
}
