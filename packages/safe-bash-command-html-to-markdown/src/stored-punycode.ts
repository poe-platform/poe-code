import type { Budget as MarkdownBudget } from "./budget.js";
type Budget = Pick<MarkdownBudget, "work" | "checkpoint">;
import type { TextStore } from "./stored-text.js";

// RFC 3492 parameters. Native URL's punycode codec uses signed 32-bit arithmetic.
const maximum = 0x7fffffff;
function adapt(delta: number, points: number, first: boolean): number {
  delta = first ? Math.floor(delta / 700) : delta >> 1;
  delta += Math.floor(delta / points);
  let k = 0;
  while (delta > 455) { delta = Math.floor(delta / 35); k += 36; }
  return k + Math.floor(36 * delta / (delta + 38));
}
function digit(character: string): number {
  const code = character.charCodeAt(0);
  return code >= 48 && code <= 57 ? code - 22 : code >= 65 && code <= 90 ? code - 65 : code >= 97 && code <= 122 ? code - 97 : 36;
}
function encodeDigit(value: number): string { return String.fromCharCode(value < 26 ? value + 97 : value + 22); }

/** RFC 3492 insertion uses scalar ranks in a caller-backed balanced rope. */
export async function decodePunycode(text: TextStore, root: number, budget: Budget): Promise<number | undefined> {
  let delimiter = -1, offset = 0;
  for await (const character of text.characters(root)) {
    budget.work(character.length);
    if (character.codePointAt(0)! > 127) return undefined;
    if (character === "-") delimiter = offset;
    offset++;
    const checkpoint = budget.checkpoint(); if (checkpoint) await checkpoint;
  }
  let output = text.builder(), count = Math.max(0, delimiter);
  if (delimiter > 0) await output.append(await text.slice(root, 0, delimiter));
  const input = text.characters(await text.slice(root, delimiter > 0 ? delimiter + 1 : 0))[Symbol.asyncIterator]();
  let n = 128, i = 0, bias = 72;
  try {
    while (true) {
      let next = await input.next();
      if (next.done) break;
      const old = i;
      let weight = 1;
      for (let k = 36; ; k += 36) {
        budget.work(1);
        const value = digit(next.value);
        if (value >= 36 || value > Math.floor((maximum - i) / weight)) return undefined;
        i += value * weight;
        const threshold = k <= bias ? 1 : k >= bias + 26 ? 26 : k - bias;
        if (value < threshold) break;
        if (weight > Math.floor(maximum / (36 - threshold))) return undefined;
        weight *= 36 - threshold;
        next = await input.next();
        if (next.done) return undefined;
      }
      bias = adapt(i - old, count + 1, old === 0);
      if (Math.floor(i / (count + 1)) > maximum - n) return undefined;
      n += Math.floor(i / (count + 1));
      i %= count + 1;
      if (n > 0x10ffff || n >= 0xd800 && n <= 0xdfff) return undefined;
      const character = String.fromCodePoint(n);
      if (i === count) await output.write(character);
      else {
        const previous = await output.finish(), position = await text.pointOffset(previous, i);
        const inserted = await text.concat(await text.concat(await text.slice(previous, 0, position), await text.from(character)), await text.slice(previous, position));
        output = text.builder(); await output.append(inserted);
      }
      count++; i++;
      const checkpoint = budget.checkpoint(); if (checkpoint) await checkpoint;
    }
    return output.finish();
  } finally { await input.return?.(undefined); }
}

/** RFC 3492 needs repeated ordered scans, but no array of the input scalars. */
export async function encodePunycode(text: TextStore, root: number, budget: Budget): Promise<number | undefined> {
  const output = text.builder();
  let basic = 0;
  for await (const character of text.characters(root)) {
    budget.work(1);
    if (character.codePointAt(0)! < 128) { await output.write(character); basic++; }
    const checkpoint = budget.checkpoint(); if (checkpoint) await checkpoint;
  }
  let handled = basic, n = 128, delta = 0, bias = 72;
  if (basic) await output.write("-");
  const count = (await text.info(root)).points;
  while (handled < count) {
    let minimum = maximum;
    for await (const character of text.characters(root)) {
      budget.work(1);
      const code = character.codePointAt(0)!;
      if (code >= n && code < minimum) minimum = code;
      const checkpoint = budget.checkpoint(); if (checkpoint) await checkpoint;
    }
    if (minimum - n > Math.floor((maximum - delta) / (handled + 1))) return undefined;
    delta += (minimum - n) * (handled + 1); n = minimum;
    for await (const character of text.characters(root)) {
      budget.work(1);
      const code = character.codePointAt(0)!;
      if (code < n && ++delta > maximum) return undefined;
      if (code === n) {
        let q = delta;
        for (let k = 36; ; k += 36) {
          const threshold = k <= bias ? 1 : k >= bias + 26 ? 26 : k - bias;
          if (q < threshold) break;
          const radix = 36 - threshold;
          await output.write(encodeDigit(threshold + (q - threshold) % radix));
          q = Math.floor((q - threshold) / radix);
        }
        await output.write(encodeDigit(q));
        bias = adapt(delta, handled + 1, handled === basic); delta = 0; handled++;
      }
      const checkpoint = budget.checkpoint(); if (checkpoint) await checkpoint;
    }
    delta++; n++;
  }
  return output.finish();
}
