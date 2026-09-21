import { expect, it } from "vitest";
import { resizeWorkbookReferences } from "./resize.js";
import type { CapabilityContext } from "../contracts.js";
import type { Workbook } from "../workbook.js";

const context = (): CapabilityContext => ({ limits: { sheets: 8, cells: 100, inputBytes: 100000, outputBytes: 100000, operations: 100 },
  signal: new AbortController().signal, environment: { env: {}, locale: "C", timezone: "UTC" }, own() {} });

// t9001 dimensions, with original tiny sparse storage rather than upstream samples.
it.each([
  { rows: 8192, columns: 256 }, { rows: 65536, columns: 128 }, { rows: 8192, columns: 128 },
  { rows: 1048576, columns: 256 }, { rows: 65536, columns: 512 }, { rows: 1048576, columns: 16384 }
])("changes dimensions without changing in-bounds contents at $rows x $columns", size => {
  const input: Workbook = { names: [{ name: "anchor", expression: "=$A$1" }], sheets: [{ id: "s", name: "Tiny", visibility: "very-hidden", cells:
    [{ row: 0, column: 0, value: { kind: "string", value: "original" }, style: { weight: "bold" } }] }] };
  const resized = resizeWorkbookReferences(input, "s", size, context());
  expect(resized.sheets[0]!.size).toEqual(size);
  expect(resized.sheets[0]!.visibility).toBe("very-hidden");
  expect(resized.sheets[0]!.cells).toEqual(input.sheets[0]!.cells);
  expect(resized.names).toEqual(input.names);
  expect(input.sheets[0]!.size).toBeUndefined();
});
