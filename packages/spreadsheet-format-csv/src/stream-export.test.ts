import { expect, it } from "vitest";
import { createEngine } from "@poe-code/spreadsheet-engine";
import { csvFormat } from "./index.js";

it("exports large CSV output in bounded chunks with backpressure", async () => {
  const engine = createEngine({ formats: [csvFormat] });
  const operation = { signal: new AbortController().signal };
  const book = await engine.adoptWorkbook({ sheets: [{ id: "s", name: "Data", cells: Array.from({ length: 1000 }, (_, row) =>
    ({ row, column: 0, value: { kind: "string" as const, value: 'a,"😀'.repeat(32) } })) }] }, operation);
  let chunks = 0, size = 0;
  await engine.writeWorkbook(book, { kind: "stream", sink: { async write(bytes) {
    expect(bytes.length).toBeLessThanOrEqual(64 * 1024);
    chunks++; size += bytes.length;
    await new Promise<void>(resolve => queueMicrotask(resolve));
  } } }, { exportType: "Gnumeric_stf:stf_csv" }, operation);
  expect(chunks).toBeGreaterThan(1);
  expect(size).toBe(new TextEncoder().encode('"' + 'a,""😀'.repeat(32) + '"\n').length * 1000);
  await engine.dispose();
});

it.each(["UTF-8", "UTF-16", "UTF-16BE", "UTF-32", "ISO-8859-1", "ASCII"])("keeps %s encoding identical across chunk boundaries", async charset => {
  const engine = createEngine({ formats: [csvFormat] });
  const operation = { signal: new AbortController().signal };
  const value = "a".repeat(16383) + "😀é";
  const book = await engine.adoptWorkbook({ sheets: [{ id: "s", name: "Data", cells: [
    { row: 0, column: 0, value: { kind: "string", value } }
  ] }] }, operation);
  const chunks: Uint8Array[] = [];
  await engine.writeWorkbook(book, { kind: "stream", sink: { async write(bytes) { chunks.push(bytes.slice()); } } },
    { exportType: "Gnumeric_stf:stf_assistant", exportOptions: [`charset=${charset}`] }, operation);
  const { encodeText } = await import("@poe-code/spreadsheet-engine/encoding/encode");
  const { defaultSsconvertLimits } = await import("@poe-code/spreadsheet-engine");
  const expected = encodeText(value + "\n", charset, true, { signal: operation.signal,
    limits: defaultSsconvertLimits, environment: { env: {}, locale: "C", timezone: "UTC" }, own() {} });
  expect(Uint8Array.from(chunks.flatMap(chunk => Array.from(chunk)))).toEqual(expected);
  await engine.dispose();
});

it("delivers the first encoded chunk before formatting the complete workbook", async () => {
  let formatted = 0, writes = 0;
  const engine = createEngine({ formats: [csvFormat], formatting: { async format() { formatted++; return "x".repeat(4096); } } });
  const operation = { signal: new AbortController().signal };
  const book = await engine.adoptWorkbook({ sheets: [{ id: "s", name: "Data", cells: Array.from({ length: 100 }, (_, row) =>
    ({ row, column: 0, value: { kind: "number" as const, value: row } })) }] }, operation);
  await engine.writeWorkbook(book, { kind: "stream", sink: { async write() {
    if (writes++ === 0) expect(formatted).toBeLessThanOrEqual(5);
    const before = formatted;
    await new Promise<void>(resolve => queueMicrotask(resolve));
    expect(formatted).toBe(before);
  } } }, { exportType: "Gnumeric_stf:stf_csv" }, operation);
  expect(formatted).toBe(100);
  expect(writes).toBeGreaterThan(1);
  await engine.dispose();
});
