import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { readLotus } from "./lotus.js";
import { writeGnumeric } from "./gnumeric.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 4, operations: 10000 } };
const record = (id: number, data: readonly number[] = []) => [id & 255, id >>> 8, data.length & 255, data.length >>> 8, ...data];
const file = (...records: readonly number[][]) => Uint8Array.from([...record(255, [4, 4]), ...records.flat(), ...record(1)]);
function double(n: number) { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, n, true); return [...b]; }
const font = (name: string, variant = 0) => record(0x5456, [variant, 0, ...Array.from(name, c => c.charCodeAt(0)), ...Array<number>(34 - name.length).fill(0), 24, 0]);
const style = (alignment: number) => record(0x545a, [0x43, alignment, 0, 0, 0, 0, 0, 0, 0, 0]);
const number = (column = 0) => record(14, [column & 255, column >>> 8, 0, 0, 0, 0, ...double(42)]);

it("Works imported alignment and wrapping survive Gnumeric XML export", async () => {
  const value = await readLotus(file(font("Arial"), style(0x68), number()), context);
  const xml = new TextDecoder().decode(await writeGnumeric(value, [], context));
  expect(xml).toContain('HAlign="GNM_HALIGN_CENTER"');
  expect(xml).toContain('VAlign="GNM_VALIGN_CENTER"');
  expect(xml).toContain('WrapText="1"');
});

it("Works applies partial styles without losing existing font attributes", async () => {
  const secondStyle = [0x43, 0, 0, 0, 255, 0, 0, 0, 0, 0];
  const last = record(14, [0, 0, 0, 0, 1, 0, ...double(17)]);
  const value = await readLotus(file(font("Arial", 1), style(0x68), number(), record(0x545a, secondStyle), last), context);
  expect(value.sheets[0]!.cells[0]!.style).toMatchObject({ fontName: "Arial", bold: true, horizontalAlignment: "general" });
  expect(value.sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 17 });
});

it("Works font suffix selects the source Cyrillic text codec", async () => {
  const value = await readLotus(file(font("Arial CYR"), style(0), record(15, [0, 0, 0, 0, 0, 0, 0xe0, 0])), context);
  expect(value.sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: "а" });
});

it("Works undefined style indexes retain prior cell styles", async () => {
  const value = await readLotus(file(font("Arial", 1), style(0), number(), record(14, [0, 0, 0, 0, 255, 0, ...double(17)])), context);
  expect(value.sheets[0]!.cells[0]!.style).toMatchObject({ fontName: "Arial", bold: true });
  expect(value.sheets[0]!.cells).toHaveLength(1);
});

it("Works warns once for multiple out-of-range cells and keeps valid later cells", async () => {
  const warnings: string[] = [];
  const value = await readLotus(file(number(256), number(257), number(255)), { ...context, async diagnostic(d) { warnings.push(d.message); } });
  expect(warnings).toEqual(["File is most likely corrupted.\n(It claims to contain a cell outside the range Gnumeric can handle.)"]);
  expect(value.sheets[0]!.cells.map(c => c.column)).toEqual([255]);
});

it("Works rejects byte admission and checks cancellation before parsing font definitions", async () => {
  const bytes = file(font("Arial"));
  await expect(readLotus(bytes, { ...context, limits: { ...context.limits, inputBytes: 5 } })).rejects.toThrow("input bytes limit exceeded");
  const controller = new AbortController(), reason = new Error("Works cancellation"); controller.abort(reason);
  await expect(readLotus(bytes, { ...context, signal: controller.signal })).rejects.toBe(reason);
});

it("Works invalid negative formula lengths do not invent expression or cached cells", async () => {
  const value = await readLotus(file(record(16, [0, 0, 0, 0, 0, 0, ...double(17), 255, 255])), context);
  expect(value.sheets[0]!.cells).toEqual([]);
});

it("Works expression traversal consumes the shared invocation budget", async () => {
  const tokens = [5, 2, 0, ...Array<number>(30).fill(0x22), 3];
  await expect(readLotus(file(record(16, [0, 0, 0, 0, 0, 0, ...double(2), tokens.length, 0, ...tokens])),
    { ...context, limits: { ...context.limits, operations: 10 } })).rejects.toThrow("operations limit exceeded");
});
