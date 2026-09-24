import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { readLotus } from "./lotus.js";
import { parseExpression } from "../formulas/parser.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 4, operations: 100, workbookWork: 10000 } };
const word = (value: number) => [value & 255, value >>> 8];
const record = (id: number, data: number[] = []) => [...word(id), ...word(data.length), ...data];
function fixture(variable: string, opcode = 7, following: number[][] = []) {
  return Uint8Array.from([...record(0, [2, 16, ...Array<number>(14).fill(0), 1, 0, 0]),
    ...record(25, [2, 0, 0, 2, ...Array<number>(10).fill(0), opcode,
      ...Array.from(variable, c => c.charCodeAt(0)), 0, 5, 2, 0, 15, 3]), ...following.flat(), ...record(1)]);
}

it.each([7, 8])("imports token %i external variables without implicit resolution", async opcode => {
  let calls = 0;
  const input = fixture("<<../book name.wk3>>Remote:AA001", opcode), before = input.slice();
  const configured: CapabilityContext = { ...context, externalReferences: { resolve(request, signal) {
    calls++;
    expect(signal).toBe(context.signal);
    expect(request).toMatchObject({ kind: "reference", first: { workbook: "../book name.wk3", sheet: "Remote",
      row: { relative: true, value: -2 }, column: { relative: true, value: 24 } } });
    return { kind: "number" as const, value: 11 };
  } } };
  const book = await readLotus(input, configured);
  expect(calls).toBe(0);
  expect(book.sheets).toHaveLength(1);
  expect(book.sheets[0]!.cells[0]!.formula).toBe("=(['../book name.wk3']'Remote'!AA1+1)");
  expect(recalculateWorkbook(book, context, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "error", value: "#REF!" });
  expect(recalculateWorkbook(book, configured, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 12 });
  expect(calls).toBe(1);
  expect(input).toEqual(before);
});

it.each([
  ["<<book]file.wk3>>O'Brian:A1", "(['book]file.wk3']'O\\'Brian'!A1+1)"],
  ["<<book>>First:A1..Last:IV65536", "(['book']'First'!A1:'Last'!IV65536+1)"],
  ["<<book>>Same:B2..Same:C3", "(['book']'Same'!B2:'Same'!C3+1)"],
  ["<<book>>Sheet:XFD16777216", "(['book']'Sheet'!XFD16777216+1)"]
])("retains external workbook and sheet spellings: %s", async (variable, expected) => {
  const book = await readLotus(fixture(variable), context);
  expect(book.sheets[0]!.cells[0]!.formula).toBe("=" + expected);
  expect(parseExpression("=" + expected, { position: { sheet: "lotus-0", row: 2, column: 2 } }).ok).toBe(true);
});

it.each(["Missing", "<<>>Sheet:A1", "<<book>Sheet:A1", "<<book>>:A1", "<<book>>Sheet:A0",
  "<<book>>Sheet:a1", "<<book>>Sheet:$A$1", "<<book>>Sheet:A1junk", "<<book>>Sheet:A1..B2",
  "<<book>>Sheet:A1..Last:B0", "<<book>>Sheet:XFE1", "<<book>>Sheet:A16777217"])(
  "preserves the unknown-name diagnostic for malformed or unqualified external syntax: %s", async variable => {
    const warnings: string[] = [];
    const book = await readLotus(fixture(variable), { ...context, async diagnostic(d) { warnings.push(d.message); } });
    expect(book.sheets[0]!.cells[0]!.formula).toBe("=(#NAME?+1)");
    expect(warnings).toEqual([`Unknown Lotus named reference '${variable}'.`]);
  });

it("prefers an explicitly defined name over external-variable fallback", async () => {
  const name = "<<b>>S:A1";
  const definition = record(9, [0, 0, ...Array.from(name, c => c.charCodeAt(0)), ...Array<number>(16 - name.length).fill(0),
    4, 0, 0, 3, 4, 0, 0, 3]);
  const book = await readLotus(fixture(name, 7, [definition]), context);
  expect(book.sheets[0]!.cells[0]!.formula).toBe("=(D5+1)");
});

it("decodes LMBCS external identities before binding both range endpoints", async () => {
  const book = await readLotus(fixture("<<caf\x82>>First:A1..Last:B2"), context);
  let calls = 0;
  const output = recalculateWorkbook(book, { ...context, externalReferences: { resolve(request) {
    calls++;
    expect(request).toMatchObject({ kind: "reference", first: { workbook: "café", sheet: "First",
      row: { value: -2 }, column: { value: -2 } }, last: { workbook: "café", sheet: "Last",
      row: { value: -1 }, column: { value: -1 } } });
    return { kind: "number", value: 11 };
  } } }, true);
  expect(calls).toBe(1);
  expect(output.sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 12 });
});

it("charges expanded external references to the aggregate expression budget", async () => {
  const input = fixture("<<a'b>>S:A1");
  await expect(readLotus(input, { ...context, limits: { ...context.limits, workbookTextBytes: 15 } }))
    .rejects.toThrow("expression text limit");
  await expect(readLotus(input, { ...context, limits: { ...context.limits, workbookTextBytes: 32 } })).resolves.toBeDefined();
});

it("propagates cancellation from the explicit external resolver", async () => {
  const controller = new AbortController(), reason = new Error("external cancellation");
  const configured = { ...context, signal: controller.signal };
  const book = await readLotus(fixture("<<book>>Sheet:A1"), configured);
  expect(() => recalculateWorkbook(book, { ...configured, externalReferences: { resolve() {
    controller.abort(reason); return { kind: "number", value: 11 };
  } } }, true)).toThrow(reason);
});
