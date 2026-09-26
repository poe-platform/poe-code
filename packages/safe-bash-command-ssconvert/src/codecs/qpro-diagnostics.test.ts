import { expect, it } from "vitest";
import { readQpro } from "./qpro.js";
import type { CapabilityContext, Diagnostic } from "../contracts.js";

const record = (id: number, data: number[] = []) => [id & 255, id >> 8, data.length & 255, data.length >> 8, ...data];
async function warnings(records: number[]) {
  const diagnostics: Diagnostic[] = [];
  const context: CapabilityContext = { signal: new AbortController().signal, own() {},
    environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 10000, outputBytes: 10000, cells: 10, sheets: 4, operations: 100 },
    async diagnostic(d) { diagnostics.push(d); } };
  const book = await readQpro(Uint8Array.from([...record(0, [1, 16]), ...record(202), ...records,
    ...record(13, [0, 0, 0, 0, 0, 0, 7, 0]), ...record(203), ...record(1)]), context);
  return { book, diagnostics, terminal: diagnostics.map(d => new TextDecoder().decode(d.bytes)).join("") };
}

it("Quattro minimum-length diagnostic retains native comma and newline", async () => {
  const result = await warnings(record(15, [0]));
  expect(result.terminal).toBe("File is most likely corrupted.\nInvalid 'QPRO_LABEL_CELL' record of length 1, expected at least 7\n");
  expect(result.book.sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 7 });
});

it.each([9, 65535])("Quattro invalid zoom %i retains IO-context warning without terminal output", async value => {
  const result = await warnings(record(309, [100, 0, value & 255, value >> 8]));
  expect(result.terminal).toBe("");
  expect(result.diagnostics.map(d => d.message)).toEqual([`Invalid zoom ${value >= 32768 ? value - 65536 : value} %`]);
  expect(result.book.sheets[0]!.view).toEqual({});
});

it("Quattro short function-argument warning has no native final newline", async () => {
  const tokens = [5, 1, 0, 32 + 10, 3]; // ATAN2 needs two arguments.
  const result = await warnings(record(16, [...Array<number>(18).fill(0), tokens.length, 0, ...tokens]));
  expect(result.terminal).toBe("File is probably corrupted.\n(Expression stack is short by 1 arguments)");
});
