import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { readLotus } from "./lotus.js";
import { writeGnumeric } from "./gnumeric.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 4, operations: 10000 } };
const record = (id: number, data: number[] = []) => [id & 255, id >> 8, data.length & 255, data.length >> 8, ...data];
const fixture = (...records: number[][]) => Uint8Array.from([...record(0, [5, 16, ...Array<number>(14).fill(0), 1, 0, 0]), ...records.flat(), ...record(1)]);

it("exports empty Lotus formatted ranges without inventing cells", async () => {
  const book = await readLotus(fixture(record(0x13, [0, 0, 3, 0, 0x32, 0, 0, 0x80, 1])), context);
  const xml = new TextDecoder().decode(await writeGnumeric(book, [], context));
  expect(xml).toContain('<gnm:StyleRegion startCol="0" startRow="3" endCol="1" endRow="3">');
  expect(xml).toContain('Format="0.00%"');
  expect(xml).not.toContain('<gnm:Cell ');
});

it("exports Lotus comment anchors, cursor and viewport as native Gnumeric structures", async () => {
  const book = await readLotus(fixture(record(5, [0, 0, 0, 0, 9, 0, 3, 2, 7, 0, 0, 0, 0, 0, 0, 0]),
    record(0x26, [2, 0, 0, 1, 0, 104, 105, 0])), context);
  const xml = new TextDecoder().decode(await writeGnumeric(book, [], context));
  expect(xml).toContain('<gnm:Selections CursorCol="3" CursorRow="9">');
  expect(xml).toContain('<gnm:Selection startCol="3" startRow="9" endCol="3" endRow="9"/>');
  expect(xml).toContain('<gnm:CellComment ObjectBound="B3" ObjectOffset="1 0 1 0" Direction="17" Print="1" Text="hi"/>');
  expect(xml).toContain('<gnm:SheetLayout TopLeft="C8"/>');
});

it("exports imported default axis sizes with native decimal precision", async () => {
  const book = await readLotus(fixture(record(6, [0, 0, 0, 0, 11])), context);
  const xml = new TextDecoder().decode(await writeGnumeric(book, [], context));
  expect(xml).toContain('<gnm:Cols DefaultSizePts="82.69"/>');
});

it("uses four significant digits for small default widths", async () => {
  const book = await readLotus(fixture(record(6, [0, 0, 0, 0, 1])), context);
  const xml = new TextDecoder().decode(await writeGnumeric(book, [], context));
  expect(xml).toContain('<gnm:Cols DefaultSizePts="7.977"/>');
});

it("preserves native scientific notation for large imported defaults", async () => {
  const xml = new TextDecoder().decode(await writeGnumeric({ sheets: [{ id: "S", name: "S", cells: [],
    view: { defaultColumnWidth: 10000 } }] }, [], context));
  expect(xml).toContain('<gnm:Cols DefaultSizePts="1e+04"/>');
});

it("exports Works alignment and wrapping with its imported font and format", async () => {
  const number = new Uint8Array(8); new DataView(number.buffer).setFloat64(0, 42, true);
  const bytes = Uint8Array.from([...record(255, [4, 4]), ...record(0x5456,
    [99, 0, ...Array.from("Arial", c => c.charCodeAt(0)), ...Array<number>(29).fill(0), 24, 0]),
    ...record(0x545a, [67, 104, 0, 0, 0, 0, 0, 0, 0, 0]), ...record(14, [0, 0, 0, 0, 0, 0, ...number]), ...record(1)]);
  const xml = new TextDecoder().decode(await writeGnumeric(await readLotus(bytes, context), [], context));
  expect(xml).toContain('HAlign="GNM_HALIGN_CENTER" VAlign="GNM_VALIGN_CENTER" WrapText="1"');
  expect(xml).toContain('Fore="FFFF:0:0"');
  expect(xml).toContain('Format="0.00%"');
  expect(xml).toContain('<gnm:Font Unit="12" Bold="1" Italic="1" Underline="0" StrikeThrough="0">Arial</gnm:Font>');
});
