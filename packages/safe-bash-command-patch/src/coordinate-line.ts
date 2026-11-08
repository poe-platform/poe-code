import type { Budget } from "safe-bash-diff-engine/shared";
import { patchTextBytes } from "./patch-text.js";
import type { PatchInput } from "./unified.js";

export interface Coordinate { value: number; prefix: string }

/** Normal/context grammars have at most four decimal fields and ten punctuation bytes. */
export async function coordinateLine(input: PatchInput, index: number, budget: Budget): Promise<{ shape: string; fields: Coordinate[] }> {
  const source = input.body ? await input.body(index, 0, true) : (await input.read(index)) ?? "";
  const fields: Coordinate[] = [];
  let shape = "", punctuation = 0, current: Coordinate | undefined;
  for await (const block of patchTextBytes(source)) {
    budget.step(block.length); const pause = budget.checkpoint(); if (pause) await pause;
    for (const byte of block) {
      if (byte >= 48 && byte <= 57) {
        if (!current) {
          if (fields.length === 4) return { shape: "", fields: [] };
          current = { value: 0, prefix: "" }; fields.push(current); shape += "0";
        }
        if (current.prefix.length < 1001) current.prefix += String.fromCharCode(byte);
        current.value = current.value * 10 + (byte - 48);
        if (!Number.isSafeInteger(current.value)) current.value = Infinity;
      } else {
        if (++punctuation > 10 || byte > 127) return { shape: "", fields: [] };
        shape += String.fromCharCode(byte); current = undefined;
      }
    }
  }
  return { shape, fields };
}
