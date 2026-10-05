import { expect, it } from "vitest";
import { decodePdftkEntities } from "./info-text.js";
import { decodePdftkEntityChunks } from "./info-entity-stream.js";

it.each(["plain😀", "&#65;", "&#65junk;", "&#x41garbage;", "&#-0;", "&#+65;", "&# \t65;", "&#x0x41;", "&#x;", "&#n&#65;;", "&#" + "0".repeat(8192) + "65;", "&#" + "9".repeat(400) + ";", "&#" + "a".repeat(8192), "&#x" + "0".repeat(8192) + "1F600;"])("preserves numeric entity semantics (%#)", async text => {
  async function* chunks(start = 0) { for (let at = start; at < text.length; at += 17) yield text.slice(at, at + 17); }
  let result = ""; for await (const part of decodePdftkEntityChunks(chunks, new AbortController().signal)) { expect(part.length).toBeLessThanOrEqual(4096); result += part; }
  expect(result).toBe(decodePdftkEntities(text));
});
it("preserves invalid Unicode scalar errors", async () => {
  async function* chunks() { yield "before &#x110000; after"; }
  await expect((async () => { for await (const part of decodePdftkEntityChunks(chunks, new AbortController().signal)) void part; })()).rejects.toBeInstanceOf(RangeError);
});
it("preserves decoding errors when closing its input also fails", async () => {
  const cleanup = new Error("cleanup failed");
  const read = (): AsyncIterable<string> => ({ [Symbol.asyncIterator]() { let sent = false; return {
    async next() { if (sent) return { done: true as const, value: undefined }; sent = true; return { done: false as const, value: "&#x110000;" }; },
    return() { throw cleanup; }
  }; } });
  await expect((async () => { for await (const part of decodePdftkEntityChunks(read, new AbortController().signal)) void part; })()).rejects.toBeInstanceOf(RangeError);
});
it.each([128, 256])("bounds replay reads for %i malformed entities", async count => {
  const text = "&x &#oops; ".repeat(count); let readUnits = 0;
  async function* chunks(start: number) { for (let at = start; at < text.length; at += 16) { const part = text.slice(at, at + 16); readUnits += part.length; yield part; } }
  let result = ""; for await (const part of decodePdftkEntityChunks(chunks, new AbortController().signal)) result += part;
  expect(result).toBe(text); expect(readUnits).toBeLessThan(text.length * 8);
});
