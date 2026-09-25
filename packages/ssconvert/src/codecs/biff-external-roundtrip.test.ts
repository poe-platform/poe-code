import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import type { Workbook } from "../workbook.js";
import { parseExpression } from "../formulas/parser.js";
import { writeBiffStream } from "./biff-write.js";
import { readBiff } from "./biff.js";
import { BiffFormulaWriter } from "./biff-write-formulas.js";
import { biffExternalPath, encodeBiffExternalPath } from "./biff-external-path.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 4, operations: 1000 } };

for (const revision of [7, 8] as const) for (const [formula, identity] of [
  ["=Here!$A$1+1", { kind: "reference", first: { sheet: "Here" } }],
  ["=['book.xls']Other!$A$1+1", { kind: "reference", first: { workbook: "book.xls", sheet: "Other" } }],
  ["=SUM(['book.xls']Other!$A$1:$B$2)", { kind: "reference", first: { workbook: "book.xls", sheet: "Other" } }],
  ["=['book.xls']Rate+1", { kind: "name", workbook: "book.xls", name: "Rate" }],
  ["=['book.xls']Other!Rate+1", { kind: "name", workbook: "book.xls", sheet: "Other", name: "Rate" }]
] as const) it(`preserves BIFF${revision} reference identity without host access: ${formula}`, async () => {
  const book: Workbook = { sheets: [{ id: "Here", name: "Here", cells: [
    { row: 0, column: 0, value: { kind: "number", value: 41 } },
    { row: 0, column: 1, value: { kind: "number", value: 42 }, cachedResult: { kind: "number", value: 42 }, formula }
  ] }] };
  let accesses = 0;
  const diagnostics: string[] = [];
  const host = { ...context, async diagnostic(value: { message: string }) { diagnostics.push(value.message); },
    externalReferences: { resolve() { accesses++; throw new Error("Unexpected host resolution"); } } };
  const input = await writeBiffStream(book, revision, false, host);
  const imported = await readBiff(input, host), cell = imported.sheets[0]!.cells.find(value => value.column === 1)!;
  expect(cell.cachedResult).toEqual({ kind: "number", value: 42 });
  expect(cell.formula).toBeDefined();
  const parsed = parseExpression(cell.formula!, { workbook: imported, position: { sheet: imported.sheets[0]!.id, row: 0, column: 1 } });
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error("Reopened formula did not parse");
  const root = parsed.document.root;
  expect(root.kind === "binary" ? root.left : root.kind === "call" ? root.args[0] : root).toMatchObject(identity);
  expect(accesses).toBe(0);
  expect(diagnostics).not.toContain("BIFF EXTERNNAME_v0 retained without semantic interpretation");
});

it.each([7, 8] as const)("keeps BIFF%i local, add-in and external namespaces separate regardless of discovery order", async revision => {
  const formulas = ["=Here!$A$1+GAMMA(5)", "=['book.xls']Other!$A$1+1", "=['second.xls']Other!Rate",
    "=['book.xls']Rate", "=['book.xls']Other!Rate", "=Here!Rate", "=IFERROR(['book.xls']Other!$A$1,0)"];
  for (const ordered of [formulas, [...formulas].reverse()]) {
    const book: Workbook = { sheets: [{ id: "Here", name: "Here", cells: ordered.map((formula, row) => ({ row, column: 0,
      value: { kind: "number", value: 42 }, formula })) }], names: [{ name: "Rate", sheet: "Here", expression: "=1" }] };
    const imported = await readBiff(await writeBiffStream(book, revision, false, context), context);
    for (const cell of imported.sheets[0]!.cells) {
      const position = { sheet: "Here", row: cell.row, column: cell.column };
      const before = parseExpression(ordered[cell.row]!, { workbook: book, position });
      const after = parseExpression(cell.formula!, { workbook: imported, position });
      expect(before.ok && after.ok).toBe(true);
      if (before.ok && after.ok) {
        const identity = (value: unknown): unknown => Array.isArray(value) ? value.map(identity) : value && typeof value === "object" ?
          Object.fromEntries(Object.entries(value).filter(([key]) => !["start", "end", "spelling"].includes(key)).map(([key, item]) => [key, identity(item)])) : value;
        expect(identity(after.document.root)).toEqual(identity(before.document.root));
      }
    }
  }
});

it.each(["book.xls", "dir/book.xls", "C:\\dir\\book.xls", "https://example.test/a[b].xls", "'book] name.xls", "表.xls"])(
  "roundtrips the workbook identity %s through VirtualPath", name => {
    expect(biffExternalPath(encodeBiffExternalPath(name))).toBe(name);
  });
it.each(["bad\0name.xls", "bad\nname.xls", "x".repeat(255), "/" + "x".repeat(252)])("refuses unrepresentable workbook path %j", path => {
  expect(() => encodeBiffExternalPath(path)).toThrow("Excel BIFF external workbook path");
});
it("refuses external sheet indexes that overlap BIFF markers instead of truncating them", () => {
  const writer = new BiffFormulaWriter({ sheets: [{ id: "Here", name: "Here", cells: [] }] }, 8, context);
  writer.compile("=['book.xls']Other!A1", "Here", 0, 0);
  writer.externalBooks[0]!.sheets.length = 0xfffe;
  expect(() => writer.compile("=['book.xls']Last!A1", "Here", 0, 0)).toThrow("sheet index");
});
it("refuses external sheet names that exceed the format limit", () => {
  const writer = new BiffFormulaWriter({ sheets: [{ id: "Here", name: "Here", cells: [] }] }, 8, context);
  expect(() => writer.compile("=['book.xls']'" + "x".repeat(32) + "'!A1", "Here", 0, 0)).toThrow("sheet name");
});
