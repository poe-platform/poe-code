import { expect, it } from "vitest";
import { readSylk, writeSylk } from "./sylk.js";
import { readDif } from "./dif.js";
import type { CapabilityContext } from "../contracts.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 3, operations: 1000 } };
const bytes = (text: string) => new TextEncoder().encode(text);

it("declares formats and fonts for styled empty positions before referencing them", async () => {
  const book = await readSylk(bytes('ID\nP;P0.000\nP;EArial;M240\nF;P0;SM1;Y1;X2\nC;Y1;X1;K1\nC;X3;K3\nE\n'), context);
  const output = new TextDecoder().decode(await writeSylk(book, [], context));
  expect(output).toContain("P;P0.000\r\n");
  expect(output.startsWith("ID;PGnumeric;N;E\r\nP;P0.000\r\nP;PGeneral\r\nP;EArial;M240\r\nP;ESans;M200\r\n")).toBe(true);
  expect(output).toContain("P;EArial;M240\r\n");
  const restored = await readSylk(bytes(output), context);
  const second = restored.sheets[0]!.unsupportedRecords?.[0]?.data;
  expect(JSON.stringify(second)).toContain("0.000");
});

it("defaults SYLK display conventions to A1 while O records reset them", async () => {
  expect((await readSylk(bytes("ID\nE\n"), context)).sheets[0]!.view?.referenceMode).toBe("A1");
  expect((await readSylk(bytes("ID\nO;V0\nE\n"), context)).sheets[0]!.view?.referenceMode).toBe("R1C1");
});

it("decodes each upper SYLK escape designator without shifting subsequent characters", async () => {
  const expected = ["¯", "¬", "®", "©", "T", "U", "V", "W", "X", "Y", "Z", "[", "\\", "]", "^", "_", "`", "Æ", "Ð", "ª", "d", "e", "f", "g", "h", "Ø", "Œ", "°", "Þ", "m", "n", "o", "p", "æ", "r", "ð", "t", "u", "v", "w", "x", "ø", "œ", "ß", "Þ", "}", "~"];
  const encoded = expected.map((_, index) => "\x1bN" + String.fromCharCode(0x50 + index)).join("");
  const book = await readSylk(bytes('ID\nC;X1;Y1;K"' + encoded + '"\nE\n'), context);
  expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: expected.join("") });
});

it("covers lower escape designators, all accent slots and truncated escapes", async () => {
  const lower = ["¡", "¢", "£", "$", "¥", "#", "§", "¤", "'", '"', "«", ",", "-", ".", "/", "°", "±", "²", "³", "4", "µ", "¶", "·", "8", "'", '"', "»", "¼", "½", "¾", "¿"];
  const accents = ["e", "è", "é", "ê", "ẽ", "e", "e", "e", "ë", "e", "e\u030a", "ȩ", "e", "e", "e", "e"];
  const encoded = lower.map((_, i) => "\x1bN" + String.fromCharCode(0x21 + i)).join("") + accents.map((_, i) => "\x1bN" + String.fromCharCode(0x40 + i) + "e").join("");
  const book = await readSylk(bytes('ID\nC;X1;Y1;K"' + encoded + '"\nC;X2;K"x\x1b\nC;X3;K"x\x1bN\nE\n'), context);
  expect(book.sheets[0]!.cells.map(cell => cell.value)).toEqual([
    { kind: "string", value: lower.join("") + accents.join("") }, { kind: "string", value: "x" }, { kind: "string", value: "xN" }
  ]);
});

it("applies only name and size from valid global-font directives", async () => {
  const book = await readSylk(bytes('ID\nP;EArial;M240;SIB\nF;N1 10\nC;X1;Y1;K1\nE\n'), context);
  expect(book.sheets[0]!.cells[0]!.style?.Font).toEqual({ Name: "Arial", Unit: 12 });
  const malformed = await readSylk(bytes('ID\nP;EArial;M240\nF;N1 nope\nC;X1;Y1;K1\nE\n'), context);
  expect(malformed.sheets[0]!.cells[0]!.style).toBeUndefined();
});

it("preserves the native nested DIF read-error diagnostic", async () => {
  await expect(readDif(bytes("DATA\n0,0\n"), context)).rejects.toThrow("E Error while reading DIF file.\n  E Unexpected end of file at line 3 while reading header.");
});

it("uses simple SYLK value matching rather than formatted text-entry inference", async () => {
  const book = await readSylk(bytes('ID\nC;Y1;X1;K1,234\nC;X2;K12%\nC;X3;K$4\nC;X4;K2024-01-02\nC;X5;K1e3\nE\n'), context);
  expect(book.sheets[0]!.cells.map(cell => cell.value)).toEqual([
    { kind: "string", value: "1,234" }, { kind: "string", value: "12%" }, { kind: "string", value: "$4" },
    { kind: "string", value: "2024-01-02" }, { kind: "number", value: 1000 }
  ]);
});

it("materializes array ranges and preserves array formulas when reading cached I records", async () => {
  const book = await readSylk(bytes('ID\nC;Y1;X1;K1;R2;C2;M{1,2;;3,4}\nC;X2;K2;I\nC;Y2;X1;K3;I\nE\n'), context);
  expect(book.sheets[0]!.cells).toHaveLength(4);
  expect(book.sheets[0]!.cells.map(cell => [cell.row, cell.column, cell.formula, cell.formulaGroup])).toEqual([
    [0, 0, "={1,2;3,4}", "array-2"], [0, 1, "={1,2;3,4}", "array-2"],
    [1, 0, "={1,2;3,4}", "array-2"], [1, 1, "={1,2;3,4}", "array-2"]
  ]);
  expect(book.sheets[0]!.cells[1]!.cachedResult).toEqual({ kind: "number", value: 2 });
  await expect(readSylk(bytes('ID\nC;Y1;X1;K1;R2;C2;M1\nE\n'), { ...context, limits: { ...context.limits, cells: 3 } })).rejects.toMatchObject({ code: "resource-limit" });
});

it("includes isolated empty styles in SYLK bounds and selects separate whole-column defaults", async () => {
  const isolated = await readSylk(bytes('ID\nP;P0.000\nP;EArial;M240\nF;P0;SM1;Y5;X3\nE\n'), context);
  const output = new TextDecoder().decode(await writeSylk(isolated, [], context));
  expect(output).toContain("B;Y5;X3;D0 0 4 2\r\n");
  expect(output).toContain("P;P0.000\r\n");
  const columns = await readSylk(bytes('ID\nP;P0.000\nP;EArial;M240\nF;P0;SM1;C2\nC;Y1;X1;K1\nC;X3;K3\nE\n'), context);
  const exported = new TextDecoder().decode(await writeSylk(columns, [], context));
  const lines = exported.split("\r\n");
  const column1 = lines.find(line => line.endsWith(";C1"));
  const column2 = lines.find(line => line.endsWith(";C2"));
  expect(column1).not.toBeUndefined();
  expect(column2).not.toBeUndefined();
  expect(column2?.slice(0, -3)).not.toBe(column1?.slice(0, -3));
  expect(exported).toContain("B;Y1;X3;D0 0 0 2\r\n");
});

it("preserves explicit empty SYLK strings in bounds and cell records", async () => {
  const book = await readSylk(bytes('ID\nC;X3;Y2;K""\nE\n'), context);
  const output = new TextDecoder().decode(await writeSylk(book, [], context));
  expect(output).toContain("B;Y2;X3;D0 0 1 2\r\n");
  expect(output).not.toContain(";C1\r\n");
  expect(output).not.toContain(";C2\r\n");
  expect(output).toContain("F;P0;SM1;Y2;X3\r\n");
  expect(output).toContain('C;Y2;X3;K""\r\n');
  expect((await readSylk(bytes(output), context)).sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: "" });
});

it("matches native long-to-int SYLK coordinate conversion and rejects long overflow", async () => {
  const book = await readSylk(bytes('ID\nC;X4294967297;Y4294967297;K1\nC;X9223372036854775808;Y9223372036854775808;K2\nE\n'), context);
  expect(book.sheets[0]!.cells).toEqual([{ row: 0, column: 0, value: { kind: "number", value: 2 } }]);
});

it("rejects SYLK decimal underflow and non-ASCII trailing space but accepts leading NBSP", async () => {
  const text = 'ID\nC;X1;Y1;K1e-999\nC;X2;K2\xa0\nC;X3;K\xa02\nC;X4;K0e-999\nC;X5;K0.000e100\nE\n';
  const book = await readSylk(Uint8Array.from(text, c => c.charCodeAt(0)), context);
  expect(book.sheets[0]!.cells.map(cell => cell.value)).toEqual([
    { kind: "string", value: "1e-999" }, { kind: "string", value: "2\xa0" }, { kind: "number", value: 2 },
    { kind: "number", value: 0 }, { kind: "number", value: 0 }
  ]);
});

it("accepts ASCII whitespace before the SYLK alignment digit count as sscanf does", async () => {
  const book = await readSylk(bytes('ID\nF;FD \t+0L;Y1;X1\nC;K7\nF;FD0 L;X2\nC;K8\nE\n'), context);
  expect(book.sheets[0]!.cells[0]!.style?.HAlign).toBe(2);
  // The trailing %c reads whitespace literally; it must not skip to L.
  expect(book.sheets[0]!.cells[1]!.style?.HAlign).toBeUndefined();
});
