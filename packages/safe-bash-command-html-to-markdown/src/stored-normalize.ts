import type { Budget } from "./budget.js";
import type { TextStore, TextBuilder } from "./stored-text.js";

// Native normalization sees only individual scalars or scalar pairs. These
// probes obtain the runtime's Unicode canonical-class ordering without keeping
// a second Unicode database in sync with its normalization implementation.
function starter(character: string): boolean {
  const probe = "\u0345" + character + "\u0334"; // classes 240 and 1 surround the scalar.
  return probe.normalize("NFD") === probe;
}
function compare(left: string, right: string): number {
  if ((left + right).normalize("NFD") !== left + right) return 1;
  if ((right + left).normalize("NFD") !== right + left) return -1;
  return 0;
}

/** NFC with caller-backed combining sequences. Canonical combining classes are
 * unsigned bytes, so at most 255 nonstarter buckets can exist, regardless of
 * label length. Each bucket retains only a bounded TextBuilder window. */
export async function normalizeStored(text: TextStore, root: number, budget: Budget): Promise<number> {
  const ordered = text.builder();
  let buckets: { representative: string; value: TextBuilder }[] = [];
  const flush = async (): Promise<void> => {
    for (const bucket of buckets)
      for await (const chunk of text.chunks(await bucket.value.finish())) await ordered.write(chunk);
    buckets = [];
  };
  for await (const character of text.characters(root)) {
    budget.work(character.length);
    for (const scalar of character.normalize("NFD")) {
      if (starter(scalar)) { await flush(); await ordered.write(scalar); }
      else {
        let low = 0, high = buckets.length;
        while (low < high) {
          const middle = Math.floor((low + high) / 2);
          if (compare(buckets[middle]!.representative, scalar) < 0) low = middle + 1;
          else high = middle;
        }
        if (!buckets[low] || compare(buckets[low]!.representative, scalar) !== 0)
          buckets.splice(low, 0, { representative: scalar, value: text.builder() });
        await buckets[low]!.value.write(scalar);
      }
    }
    const checkpoint = budget.checkpoint(); if (checkpoint) await checkpoint;
  }
  await flush();
  const result = text.builder();
  let head = "", marks = text.builder(), previous: string | undefined;
  for await (const character of text.characters(await ordered.finish())) {
    budget.work(character.length);
    const zero = starter(character);
    if (head && (previous === undefined || !zero && compare(previous, character) < 0)) {
      const composed = (head + character).normalize("NFC");
      if (Array.from(composed).length === 1) { head = composed; continue; }
    }
    if (zero) {
      await result.write(head); await result.append(await marks.finish());
      head = character; marks = text.builder(); previous = undefined;
    } else { await marks.write(character); previous = character; }
    const checkpoint = budget.checkpoint(); if (checkpoint) await checkpoint;
  }
  await result.write(head); await result.append(await marks.finish());
  return result.finish();
}
