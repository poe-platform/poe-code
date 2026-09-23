import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { readBiff } from "./biff.js";
import { readGnumeric, writeGnumeric } from "./gnumeric.js";
import type { Workbook } from "../workbook.js";

// Independent fixtures: NAME headers and records are authored directly rather
// than reusing the parser's test builders or native-generated workbook bytes.
const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 4096, outputBytes: 4096, cells: 16, sheets: 4, operations: 64 } };
function frame(opcode: number, data: readonly number[]): number[] {
  return [opcode & 255, opcode >> 8, data.length & 255, data.length >> 8, ...data];
}
function workbook(name: readonly number[], expression: readonly number[], scope = 0, declaredLength = expression.length): Uint8Array {
  return new Uint8Array([
    ...frame(0x809, [0, 6, 5, 0]),
    ...frame(0x18, [0, 0, 0, name.length, declaredLength & 255, declaredLength >> 8, 0, 0, scope, 0, 0, 0, 0, 0, 0, ...name, ...expression]),
    ...frame(10, []), ...frame(0x809, [0, 6, 16, 0]), ...frame(10, [])
  ]);
}

it("imports zero-token NAME placeholders as #NAME? like stable excel_parse_name", async () => {
  expect((await readBiff(workbook([78], []), context)).names)
    .toEqual([{ name: "N", expression: "=#NAME?" }]);
});

it("resolves worksheet NAME scope after the global stream closes", async () => {
  expect((await readBiff(workbook([78], [0x1e, 7, 0], 1), context)).names)
    .toEqual([{ name: "N", expression: "=7", sheet: "Worksheet" }]);
});

it("rejects invalid scope without silently promoting a local name to workbook scope", async () => {
  await expect(readBiff(workbook([78], [0x1e, 7, 0], 2), context)).rejects.toThrow("invalid name sheet scope");
});

it("bounds token lengths even for otherwise valid NAME headers", async () => {
  await expect(readBiff(workbook([78], [0x1e, 7, 0], 0, 4), context)).rejects.toThrow("truncated binary data");
});

it("checks NAME string budgets before token materialization", async () => {
  await expect(readBiff(workbook([78, 65], [0x1e, 7, 0]), {
    ...context, limits: { ...context.limits, workbookTextBytes: 5 }
  })).rejects.toMatchObject({ code: "resource-limit" });
});

it("preserves the caller's abort reason before parsing any NAME bytes", async () => {
  const controller = new AbortController(), reason = new Error("name stress stop"); controller.abort(reason);
  await expect(readBiff(workbook([78], []), { ...context, signal: controller.signal })).rejects.toBe(reason);
});

it("retains the original NAME record when an unsupported formula token prevents translation", async () => {
  const diagnostics: string[] = [];
  const bytes = workbook([78], [0x18, 0xab, 0xcd]);
  const book = await readBiff(bytes, { ...context,
    async diagnostic(diagnostic) { diagnostics.push(diagnostic.code); } });
  const originalName = "0000000103000000000000000000004e18abcd";
  expect(book.unsupportedRecords).toContainEqual({ source: "biff", kind: "NAME_v0", disposition: "retained",
    data: { opcode: 0x18, offset: 8, bytes: originalName } });
  expect(diagnostics).toEqual(["biff-loss-warning"]);
});

it("charges unsupported NAME bytes to the retained-metadata budget", async () => {
  await expect(readBiff(workbook([78], [0x18, 0xab, 0xcd]), {
    ...context, limits: { ...context.limits, workbookTextBytes: 20 }
  })).rejects.toMatchObject({ code: "resource-limit" });
});

it("exports plain and prefixed names without altering embedded equals or XML-sensitive strings", async () => {
  const expressions = ["42", "=42", "=#NAME?", "#REF!", '=IF(A1="=",1,0)', '="a&<b=""c"'];
  const book: Workbook = { sheets: [{ id: "Sheet", name: "Sheet", cells: [] }],
    names: expressions.map((expression, index) => ({ name: `N${index}`, expression })) };
  const xml = await writeGnumeric(book, [], context);
  expect((await readGnumeric(xml, context)).names?.map(name => name.expression))
    .toEqual(["42", "42", "#NAME?", "#REF!", 'IF(A1="=",1,0)', '"a&<b=""c"', '"Sheet"', "#REF!"]);
});

it("keeps global and local duplicate names in their original scopes and preserves positions", async () => {
  const book: Workbook = { sheets: [{ id: "Sheet", name: "Sheet", cells: [] }], names: [
    { name: "Shared", expression: "=2", sheet: "Sheet", position: { sheet: "Sheet", row: 3, column: 2 } },
    { name: "Shared", expression: "=1" }
  ] };
  const replay = await readGnumeric(await writeGnumeric(book, [], context), context);
  const sheet = replay.sheets[0]!.id;
  expect(replay.names).toEqual([
    { name: "Shared", expression: "1", position: { sheet, row: 0, column: 0 } },
    { name: "Shared", expression: "2", sheet, position: { sheet, row: 3, column: 2 } },
    { name: "Sheet_Title", expression: '"Sheet"', sheet, position: { sheet, row: 0, column: 0 } },
    { name: "Print_Area", expression: "#REF!", sheet, position: { sheet, row: 0, column: 0 } }
  ]);
});
