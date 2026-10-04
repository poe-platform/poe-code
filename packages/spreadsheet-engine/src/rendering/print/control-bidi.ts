import createBidi, {type Bidi} from "bidi-js";

const bidi = (createBidi as unknown as () => Bidi)();

/** Pango's single-paragraph FriBidi profile for mixed letter/tab/control runs. */
export function controlBidiItems(text: string, direction: "ltr" | "rtl", tick: (amount?: number) => void): {
  items: {text: string; direction: "ltr" | "rtl"}[]; order: number[];
} | undefined {
  tick(text.length * 128);
  const types = Array.from(text, char => bidi.getBidiCharTypeName(char));
  // Wider weak/neutral/explicit profiles need independent native qualification.
  if (!types.includes("L") || !types.includes("R") || types.some(type => !["L", "R", "BN", "B", "S"].includes(type))) return;
  const levels = new Uint8Array(text.length);
  let start = 0;
  for (let index = 0; index <= text.length; index++) {
    tick();
    if (index < text.length && text[index] !== "\r" && text[index] !== "\u2029") continue;
    // FriBidi X8 stops explicit-level assignment at the first B. Later
    // letters retain the initialized zero base before implicit resolution.
    levels.set(bidi.getEmbeddingLevels(text.slice(start, index), start === 0 ? direction : "ltr").levels, start);
    if (index < text.length) levels[index] = direction === "rtl" ? 1 : 0;
    start = index + 1;
  }
  // FriBidi L1 restores segment/paragraph separators to the original base.
  let afterParagraph = false;
  for (let index = 0; index < text.length; index++) {
    tick();
    if (text[index] === "\r" || text[index] === "\u2029") afterParagraph = true;
    if (afterParagraph && bidi.getBidiCharTypeName(text[index]!) === "BN") levels[index] = 0;
    if (text[index] === "\t") levels[index] = direction === "rtl" ? 1 : 0;
  }
  let reset = true;
  for (let index = text.length - 1; index >= 0; index--) {
    tick();
    const char = text[index]!;
    if (char === "\t" || char === "\r" || char === "\u2029") reset = true;
    else if (bidi.getBidiCharTypeName(char) !== "BN") reset = false;
    if (reset) levels[index] = direction === "rtl" ? 1 : 0;
  }
  const items: {text: string; direction: "ltr" | "rtl"}[] = [];
  const itemLevels: number[] = [];
  let previousControl = true;
  for (let index = 0; index < text.length; index++) {
    tick();
    const char = text[index]!, level = levels[index]!;
    const control = char === "\t" || char === "\r" || char === "\u2029";
    if (control || previousControl || level !== itemLevels.at(-1)) {
      items.push({text: "", direction: level % 2 ? "rtl" : "ltr"});
      itemLevels.push(level);
    }
    items.at(-1)!.text += char;
    previousControl = control;
  }
  const order = items.map((_, index) => index);
  const max = itemLevels.reduce((max, level) => Math.max(max, level), 0);
  // Reorder the single rendered line, including controls, as Pango does.
  for (let level = max; level >= 1; level--) {
    for (let first = 0; first < order.length;) {
      tick();
      if (itemLevels[order[first]!]! < level) {first++; continue;}
      let last = first;
      while (last < order.length && itemLevels[order[last]!]! >= level) {tick(); last++;}
      for (let a = first, b = last - 1; a < b; a++, b--) [order[a], order[b]] = [order[b]!, order[a]!];
      first = last;
    }
  }
  return {items, order};
}
