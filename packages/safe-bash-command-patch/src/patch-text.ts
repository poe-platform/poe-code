import type { ByteSource } from "safe-bash-contracts";
import type { Budget } from "safe-bash-diff-engine/shared";
import { byteLength } from "safe-bash-io-engine/byte-encoding";

/** Replayable UTF-8 text; the owner retains the source until parsing finishes. */
export type PatchText = string | { readonly bytes: ByteSource; readonly size: number; readonly terminated: boolean };

export function textSize(text: PatchText): number { return typeof text === "string" ? byteLength(text) : text.size; }
export function terminated(text: PatchText): boolean { return typeof text === "string" ? text.endsWith("\n") : text.terminated; }

export async function* patchTextBytes(text: PatchText): ByteSource {
  if (typeof text !== "string") { yield* text.bytes; return; }
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + 4096, text.length);
    const last = text.charCodeAt(end - 1);
    if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--;
    yield new TextEncoder().encode(text.slice(start, end));
    start = end;
  }
}

export async function materializeText(text: PatchText): Promise<string> {
  if (typeof text === "string") return text;
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  let result = "";
  for await (const bytes of text.bytes) result += decoder.decode(bytes, { stream: true });
  return result + decoder.decode();
}

export async function equalPatchText(left: PatchText, right: PatchText, budget: Budget): Promise<boolean> {
  if (typeof left === "string" && typeof right === "string") return budget.equal(left, right);
  if (textSize(left) !== textSize(right)) return false;
  const a = patchTextBytes(left)[Symbol.asyncIterator](), b = patchTextBytes(right)[Symbol.asyncIterator]();
  try {
    let x = await a.next(), y = await b.next(), i = 0, j = 0;
    while (!x.done && !y.done) {
      const count = Math.min(x.value.length - i, y.value.length - j);
      budget.step(count);
      for (let at = 0; at < count; at++) if (x.value[i + at] !== y.value[j + at]) return false;
      i += count; j += count;
      if (i === x.value.length) { x = await a.next(); i = 0; }
      if (j === y.value.length) { y = await b.next(); j = 0; }
      const pause = budget.checkpoint(); if (pause) await pause;
    }
    return !!x.done && !!y.done;
  } finally { await a.return?.(); await b.return?.(); }
}
