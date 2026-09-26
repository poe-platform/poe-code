import { expect, it } from "vitest";
import { createEngine } from "../engine.js";

// Original DBF bytes. boot.c uses gnm_strto, not JavaScript parseFloat.
it.each([["0x1.8p+2", 0], ["-0xAp-1tail", 0], [" 12.5tail", 12.5], ["garbage", 0], ["\u00a012", 0], ["-0", 0], ["-1e-999", 0]] as const)(
  "imports C-locale DBF numeric prefix %s", async (text, expected) => {
    const bytes = new Uint8Array(83), view = new DataView(bytes.buffer);
    bytes[0] = 3; bytes[29] = 3;
    view.setUint32(4, 1, true); view.setUint16(8, 66, true); view.setUint16(10, 17, true);
    bytes.set(new TextEncoder().encode("Amount"), 32); bytes[43] = 78; bytes[48] = 16;
    bytes[64] = 13; bytes[66] = 32; bytes.fill(32, 67);
    bytes.set(Uint8Array.from(text, character => character.charCodeAt(0)), 67);
    const engine = createEngine({ codecs: [], environment: { env: {}, locale: "C", timezone: "UTC" },
      limits: { inputBytes: 1000, outputBytes: 1000, cells: 10, sheets: 1, operations: 10 } });
    try {
      const book = await engine.readWorkbook({ kind: "stream", filename: "original.dbf", source: [bytes] }, {},
        { signal: new AbortController().signal });
      expect(book.sheets[0]!.cells[1]!.value).toEqual({ kind: "number", value: expected });
    } finally { await engine.dispose(); }
  });

it.each(["inf", "-INFINITYtail", "nan", "1e999"])("preserves DBF nonfinite prefix %s as a numeric error", async text => {
  const bytes = new Uint8Array(83), view = new DataView(bytes.buffer);
  bytes[0] = 3; bytes[29] = 3; view.setUint32(4, 1, true);
  view.setUint16(8, 66, true); view.setUint16(10, 17, true);
  bytes.set(new TextEncoder().encode("Amount"), 32); bytes[43] = 78; bytes[48] = 16;
  bytes[64] = 13; bytes[66] = 32; bytes.fill(32, 67); bytes.set(new TextEncoder().encode(text), 67);
  const engine = createEngine({ codecs: [], environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 1000, outputBytes: 1000, cells: 10, sheets: 1, operations: 10 } });
  try {
    const book = await engine.readWorkbook({ kind: "stream", filename: "original.dbf", source: [bytes] }, {},
      { signal: new AbortController().signal });
    expect(book.sheets[0]!.cells[1]!.value).toEqual({ kind: "error", value: "#NUM!" });
  } finally { await engine.dispose(); }
});
