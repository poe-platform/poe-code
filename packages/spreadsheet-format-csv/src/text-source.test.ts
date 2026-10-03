import { expect, it, vi } from "vitest";
import { defaultSsconvertLimits, type CapabilityContext } from "@poe-code/spreadsheet-engine";
import { readText } from "./text.js";
import { readTextSource } from "./text-source.js";

const context = (filename: string): CapabilityContext => ({ signal: new AbortController().signal,
  environment: { locale: "C", timezone: "UTC", env: {} }, limits: defaultSsconvertLimits, inputFilename: filename, own() {} });

it.each(["data.csv", "data.txt"])("preserves text import across range boundaries for %s", async filename => {
  const cases = ["", "a,b\n1,2\n", '"a,b",c\n"x""y",2', '"unclosed\nfield', "  \n\t\n  a  ,  b  \r\n1,2", "a,b,", ",,", "\n\n", '"a", "b"\n1,2', '"x"😀;y\n1;2', "a\r\nb\nc\rd", "=1+2,3\n4,5", "a\0b,\ufeff", "a:b\n1:2"];
  let seed = 71;
  const alphabet = ['a', 'b', ',', ';', ':', '"', ' ', '\t', '\r', '\n'];
  for (let i = 0; i < 100; i++) {
    let value = "";
    for (let j = 0; j < 35; j++) { seed = (seed * 1664525 + 1013904223) >>> 0; value += alphabet[seed % alphabet.length]; }
    cases.push(value);
  }
  for (const text of cases) {
    const bytes = new TextEncoder().encode(text);
    for (const width of [1, 3, 19]) {
      const buffer = new Uint8Array(width);
      const actual = await readTextSource({ size: bytes.length, async read(offset, maximum) {
        const length = Math.min(width, maximum, bytes.length - offset);
        buffer.set(bytes.subarray(offset, offset + length)); return buffer.subarray(0, length);
      } }, context(filename));
      expect(actual, JSON.stringify({ text, width, filename })).toEqual(await readText(bytes, context(filename)));
    }
  }
});

it("registers range ingestion without collecting generated input", async () => {
  const { createEngine } = await import("@poe-code/spreadsheet-engine");
  const { csvFormat } = await import("./index.js");
  const size = 256 * 1024, buffer = new Uint8Array(16384);
  let largest = 0, reads = 0;
  const engine = createEngine({ formats: [csvFormat] });
  const NativeBytes = Uint8Array;
  vi.stubGlobal("Uint8Array", new Proxy(NativeBytes, { construct(target, args) {
    if (typeof args[0] === "number" && args[0] > 32768) throw new Error("payload-wide input allocation");
    return Reflect.construct(target, args);
  } }));
  try {
    const book = await engine.readWorkbook({ kind: "range", filename: "spaces.txt", source: {
      size, async read(offset, maximum) {
        largest = Math.max(largest, maximum); reads++;
        const count = Math.min(maximum, size - offset);
        for (let i = 0; i < count; i++) buffer[i] = (offset + i) % 2 ? 10 : 32;
        return buffer.subarray(0, count);
      }
    } }, {}, { signal: new AbortController().signal });
    expect(book.sheets[0]!.cells).toEqual([]);
    expect(book.sheets[0]!.size!.rows).toBe(size / 2);
    expect(largest).toBeLessThanOrEqual(16384);
    expect(reads).toBeGreaterThan(3 * size / 16384);
  } finally { vi.unstubAllGlobals(); await engine.dispose(); }
});
