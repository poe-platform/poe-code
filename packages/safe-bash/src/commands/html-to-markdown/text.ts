import { Builder, type Budget } from "./budget.js";

export const htmlSpace = (character: string | undefined): boolean => character === " " || character === "\t" || character === "\r" || character === "\n" || character === "\f";

export async function trimText(text: string, budget: Budget): Promise<string> {
  let start = 0, end = text.length;
  while (start < end && htmlSpace(text[start])) {
    budget.work(1);
    if (++start % 4096 === 0) await budget.checkpoint();
  }
  while (end > start && htmlSpace(text[end - 1])) {
    budget.work(1);
    if (--end % 4096 === 0) await budget.checkpoint();
  }
  budget.work(2);
  if (start === 0 && end === text.length) return text;
  budget.work(end - start);
  return text.slice(start, end);
}

export async function normalizeText(text: string, budget: Budget, mode: "space" | "lines" | "inline", maximum?: number): Promise<string> {
  const result = new Builder(budget, maximum);
  let previousSpace = false;
  for (let offset = 0; offset < text.length;) {
    const character = String.fromCodePoint(text.codePointAt(offset)!);
    budget.work(character.length);
    offset += character.length;
    if (mode === "space" && htmlSpace(character)) {
      if (!previousSpace) result.append(" ");
      previousSpace = true;
    } else {
      previousSpace = false;
      if (mode === "lines" && character === "\r") {
        if (text[offset] === "\n") { budget.work(1); offset++; }
        result.append("\n");
      } else result.append(mode === "inline" && character === "\n" ? " " : character);
    }
    if (offset % 4096 <= 1) await budget.checkpoint();
  }
  await budget.checkpoint();
  return result.finish();
}
