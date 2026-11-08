import { expect, it } from "vitest";
import type { CapabilityContext, Diagnostic } from "../contracts.js";
import { readQpro } from "./qpro.js";
import { qproFunctions } from "./qpro-functions.js";
const record = (id: number, data: readonly number[] = []) => [id & 255, id >>> 8, data.length & 255, data.length >>> 8, ...data];
const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 10, sheets: 4, operations: 10000 } };
const file = (...records: readonly number[][]) => Uint8Array.from([...record(0, [1, 16]), ...record(202), ...records.flat(), ...record(203), ...record(1)]);
const terminal = (diagnostics: readonly Diagnostic[]) => diagnostics.map(d => new TextDecoder().decode(d.bytes)).join("");

it("QPro blank records reset existing cell alignment while preserving their values", async () => {
  const book = await readQpro(file(record(15, [0, 0, 0, 0, 0, 0, 94, 120]), record(12, [0, 0, 0, 0, 0, 0])), context);
  expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: "x" });
  expect(book.sheets[0]!.cells[0]!.style).toBeUndefined();
});

const formulaRecord = (tokens: readonly number[]) => record(16, [...Array<number>(18).fill(0), tokens.length, 0, ...tokens]);
it("QPro native-unavailable AVG leaves its count byte unconsumed as a subsequent reference opcode", async () => {
  const diagnostics: Diagnostic[] = [];
  const book = await readQpro(file(formulaRecord([5, 2, 0, 81, 1, 3])), { ...context, async diagnostic(d) { diagnostics.push(d); } });
  expect(book.sheets[0]!.cells).toEqual([]);
  expect(diagnostics.map(d => d.message)).toEqual(["QPRO function avg is not supported!", "File is most likely corrupted.\n", 'Condition "end - refs >= 6" failed.\n']);
});

it("QPro native-unavailable fixed-arity DAVG preserves the existing formula stack", async () => {
  const diagnostics: Diagnostic[] = [];
  const opcode = 32 + qproFunctions.findIndex(([name]) => name === "DAVG");
  const book = await readQpro(file(formulaRecord([5, 2, 0, opcode, 3])), { ...context, async diagnostic(d) { diagnostics.push(d); } });
  expect(book.sheets[0]!.cells[0]!.formula).toBe("=2");
  expect(diagnostics.map(d => d.message)).toEqual(["QPRO function davg is not supported!"]);
});

it("QPro emits its corruption prefix once and preserves exact/minimum record diagnostics in order", async () => {
  const diagnostics: Diagnostic[] = [];
  await readQpro(file(record(36), record(15, [0]), record(13, [0, 0, 0, 0, 0, 0, 7, 0])),
    { ...context, async diagnostic(d) { diagnostics.push(d); } });
  expect(terminal(diagnostics)).toBe("File is most likely corrupted.\nInvalid 'QPRO_PROTECTION' record of length 0 instead of 1\nInvalid 'QPRO_LABEL_CELL' record of length 1, expected at least 7\n");
});

it("QPro short operands concatenate the next native terminal diagnostic without an invented newline", async () => {
  const diagnostics: Diagnostic[] = [];
  await readQpro(file(formulaRecord([5, 1, 0, 42, 3]), record(15, [1, 0, 0, 0, 0, 0, 255, 120])),
    { ...context, async diagnostic(d) { diagnostics.push(d); } });
  expect(terminal(diagnostics)).toBe("File is probably corrupted.\n(Expression stack is short by 1 arguments)Ignoring unknown alignment\n");
});

it.each([10, 400])("QPro zoom boundary %i imports without diagnostic", async zoom => {
  const diagnostics: Diagnostic[] = [];
  const book = await readQpro(file(record(309, [100, 0, zoom & 255, zoom >>> 8])),
    { ...context, async diagnostic(d) { diagnostics.push(d); } });
  expect(book.sheets[0]!.view?.zoom).toBe(zoom / 100);
  expect(diagnostics).toEqual([]);
});

it("QPro suppressed zoom diagnostics retain cancellation semantics", async () => {
  const controller = new AbortController(), reason = new Error("stop IO-context warning");
  await expect(readQpro(file(record(309, [100, 0, 145, 1])), { ...context, signal: controller.signal,
    async diagnostic(d) { expect(d.message).toBe("Invalid zoom 401 %"); expect(d.bytes).toEqual(new Uint8Array()); controller.abort(reason); } })).rejects.toBe(reason);
});

it("QPro installed SUM and native unavailable-arity PMT take their distinct source paths", async () => {
  const diagnostics: Diagnostic[] = [];
  const sum = await readQpro(file(formulaRecord([5, 2, 0, 80, 1, 3])), { ...context, async diagnostic(d) { diagnostics.push(d); } });
  expect(sum.sheets[0]!.cells[0]!.formula).toBe("=SUM(2)"); expect(diagnostics).toEqual([]);
  const pmt = await readQpro(file(formulaRecord([5, 2, 0, 56, 3])), { ...context, async diagnostic(d) { diagnostics.push(d); } });
  expect(pmt.sheets[0]!.cells).toEqual([]);
  expect(diagnostics.map(d => d.message)).toEqual(["QPRO function pmt is not supported."]);
});

it("QPro later numeric records update caches without discarding an existing expression", async () => {
  const book = await readQpro(file(formulaRecord([5, 2, 0, 3]), record(13, [0, 0, 0, 0, 0, 0, 7, 0])), context);
  expect(book.sheets[0]!.cells[0]).toMatchObject({ formula: "=2", value: { kind: "number", value: 7 },
    cachedResult: { kind: "number", value: 7 }, formulaDirty: false });
});
