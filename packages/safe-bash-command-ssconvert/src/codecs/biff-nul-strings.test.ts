import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import type { Workbook } from "../workbook.js";
import { createBiffWriter, readBiff } from "./biff.js";
import { biffString } from "./biff-write.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 1000000, outputBytes: 1000000, cells: 100, sheets: 2, operations: 1000 } };

// LibreOffice XclExpString::Assign/Build/CharsToBuffer/WriteBuffer carry explicit
// lengths for both legacy bytes and UTF-16; NUL is not a record terminator.
for (const revision of [7, 8] as const) {
  it.each(["\0AZ", "A\0Z", "AZ\0", "\0\0", "AZ"])(`preserves BIFF${revision} string bytes and length: %j`, text => {
    const bytes = biffString(text, revision, context);
    expect(new DataView(bytes.buffer).getUint16(0, true)).toBe(text.length);
    expect([...bytes.subarray(revision === 8 ? 3 : 2)]).toEqual([...text].flatMap(c => revision === 8 ? [c.charCodeAt(0), 0] : [c.charCodeAt(0)]));
  });

  it(`preserves BIFF${revision} NUL in cells, formula literals, caches and array strings`, async () => {
    const text = "A\0Z";
    const book: Workbook = { sheets: [{ id: "s", name: "S", cells: [
      { row: 0, column: 0, value: { kind: "string", value: text } },
      { row: 1, column: 0, formula: `="${text}"`, value: { kind: "string", value: text }, cachedResult: { kind: "string", value: text } },
      { row: 2, column: 0, formula: `=INDEX({"${text}","next"},1,1)`, value: { kind: "string", value: text } },
    ] }] };
    const result = await readBiff(await createBiffWriter(revision)(book, [], context), context);
    expect(result.sheets[0]!.cells.map(c => c.value)).toEqual(book.sheets[0]!.cells.map(c => c.value));
    expect(result.sheets[0]!.cells[1]!.formula).toContain(text);
    expect(result.sheets[0]!.cells[1]!.cachedResult).toEqual({ kind: "string", value: text });
    expect(result.sheets[0]!.cells[2]!.formula).toContain(text);
  });

  it(`preserves BIFF${revision} strings across continuations after NUL`, async () => {
    const text = "x".repeat(4100) + "\0" + "z".repeat(4200);
    const book: Workbook = { sheets: [{ id: "s", name: "S", cells: [
      { row: 0, column: 0, value: { kind: "string", value: text } },
      { row: 1, column: 0, formula: '=REPT("x",8301)', value: { kind: "string", value: text } },
    ] }] };
    const result = await readBiff(await createBiffWriter(revision)(book, [], context), context);
    expect(result.sheets[0]!.cells.map(c => c.value)).toEqual(book.sheets[0]!.cells.map(c => c.value));
  });
}
