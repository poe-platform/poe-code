import type { PagedStorage } from "@poe-code/safe-fs/storage";
import { yieldTurn } from "safe-bash-contracts/yield";
import type { SofficeSnapshot } from "./retained-input.js";

/** Preserve Writer's trim-before-entity-expansion behavior without retaining a text value. */
export async function retainXmlText(storage: PagedStorage, source: AsyncIterable<Uint8Array>, signal: AbortSignal, trim = true): Promise<SofficeSnapshot> {
  const position = storage.allocate(0), decoder = new TextDecoder("utf-8", { ignoreBOM: true });
  let size = 0, first = -1, last = 0, offset = 0, entities = false;
  const inspect = (text: string) => {
    if (!trim) { entities ||= text.includes("&"); return; }
    for (const character of text) {
      const point = character.codePointAt(0)!;
      const length = point < 128 ? 1 : point < 2048 ? 2 : point < 65536 ? 3 : 4;
      if (character.trim()) { if (first < 0) first = offset; last = offset + length; }
      if (character === "&") entities = true;
      offset += length;
    }
  };
  for await (const chunk of source) {
    signal.throwIfAborted();
    for (let at = 0; at < chunk.length; at += 16384) {
      const bytes = chunk.subarray(at, at + 16384);
      await storage.append(bytes); size += bytes.length;
      inspect(decoder.decode(bytes, { stream: true }));
    }
  }
  inspect(decoder.decode());
  let result = trim ? { position: position + (first < 0 ? size : first), size: first < 0 ? 0 : last - first } : { position, size };
  if (!entities || !result.size) return result;
  // Compatibility requires separate passes: a numeric reference may introduce
  // a decimal reference, and ampersands expand after the other named entities.
  for (const [prefix, replacement] of [["&#x", 16], ["&#", 10], ["&lt;", "<"], ["&gt;", ">"], ["&quot;", '"'], ["&apos;", "'"], ["&amp;", "&"]] as const)
    result = await replace(storage, result, prefix, replacement, signal);
  return result;
}

async function replace(storage: PagedStorage, source: SofficeSnapshot, prefix: string, replacement: string | number, signal: AbortSignal): Promise<SofficeSnapshot> {
  const position = storage.allocate(0), encoder = new TextEncoder();
  const buffer = new Uint8Array(16384);
  let used = 0, size = 0, pageStart = -1, page = new Uint8Array();
  const byte = async (at: number): Promise<number> => {
    if (at >= source.size) return -1;
    if (at < pageStart || at >= pageStart + page.length) {
      signal.throwIfAborted(); pageStart = at;
      page = new Uint8Array(await storage.read(source.position + at, Math.min(16384, source.size - at)));
      await yieldTurn(signal);
    }
    return page[at - pageStart]!;
  };
  const write = async (bytes: Uint8Array) => {
    for (let offset = 0; offset < bytes.length;) {
      const length = Math.min(buffer.length - used, bytes.length - offset);
      buffer.set(bytes.subarray(offset, offset + length), used);
      offset += length; used += length; size += length;
      if (used === buffer.length) { await storage.append(buffer); used = 0; }
    }
  };
  for (let at = 0; at < source.size;) {
    if (await byte(at) !== 38) {
      const amp = page.indexOf(38, at - pageStart), end = amp < 0 ? page.length : amp;
      await write(page.subarray(at - pageStart, end)); at = pageStart + end;
      continue;
    }
    const start = at;
    let matched = true;
    for (let index = 0; index < prefix.length; index++) if (await byte(at + index) !== prefix.charCodeAt(index)) { matched = false; break; }
    if (!matched) { await write(Uint8Array.of(38)); at++; continue; }
    at += prefix.length;
    if (typeof replacement === "string") {
      await write(encoder.encode(replacement));
      continue;
    }
    let value = 0, digits = 0;
    for (;;) {
      const next = await byte(at);
      const digit = next >= 48 && next <= 57 ? next - 48 : replacement === 16 && next >= 65 && next <= 70 ? next - 55 : replacement === 16 && next >= 97 && next <= 102 ? next - 87 : -1;
      if (digit < 0) break;
      value = value * replacement + digit; digits++; at++;
    }
    if (digits && await byte(at) === 59) {
      await write(encoder.encode(String.fromCodePoint(value))); at++;
    } else {
      // Invalid references survive verbatim, even with arbitrarily many digits.
      for (let index = start; index < at;) {
        await byte(index);
        const length = Math.min(at - index, pageStart + page.length - index);
        await write(page.subarray(index - pageStart, index - pageStart + length)); index += length;
      }
    }
  }
  if (used) await storage.append(buffer.subarray(0, used));
  return { position, size };
}
