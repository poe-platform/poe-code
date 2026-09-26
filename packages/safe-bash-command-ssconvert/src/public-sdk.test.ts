import { expect, it } from "vitest";
import * as sdk from "safe-bash-command-ssconvert";
import type { CapabilityContext, Workbook } from "safe-bash-command-ssconvert";

const context: CapabilityContext = {
  signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 1000000, outputBytes: 1000000, cells: 10, sheets: 2, operations: 20 }
};
it("exports reusable bounded XLSX codecs and captured help through the public SDK", async () => {
  expect(sdk).toHaveProperty("readXlsx", expect.any(Function));
  expect(sdk).toHaveProperty("createXlsxWriter", expect.any(Function));
  expect(sdk).toHaveProperty("referenceText");
  const book: Workbook = { sheets: [{ id: "original", name: "Original", cells: [
    { row: 0, column: 0, value: { kind: "string", value: "Portable λ" } },
    { row: 1, column: 1, value: { kind: "number", value: 42 } }
  ] }] };
  for (const edition of ["2006", "2008"] as const) {
    const bytes = await sdk.createXlsxWriter(edition)(book, [], context);
    const reopened = await sdk.readXlsx(bytes, context);
    expect(reopened.sheets[0]?.name).toBe("Original");
    expect(reopened.sheets[0]?.cells.map(cell => cell.value)).toEqual(book.sheets[0]!.cells.map(cell => cell.value));
    await expect(sdk.readXlsx(bytes, { ...context, limits: { ...context.limits, inputBytes: bytes.length - 1 } }))
      .rejects.toMatchObject({ code: "resource-limit" });
    const controller = new AbortController(), reason = new Error("cancel reusable reader");
    controller.abort(reason);
    await expect(sdk.readXlsx(bytes, { ...context, signal: controller.signal })).rejects.toBe(reason);
  }
});

// Adding an SDK request field requires assigning its command operation/configuration.
const commandCoverage = {
  input: "INFILE", destination: "OUTFILE/-M", importType: "-I", importEncoding: "-E",
  exportType: "-T", exportOptions: "-O", updates: "--set", updateExpressions: "--set",
  selection: "-O sheet/active-sheet/sheets", exportRange: "--export-range",
  exportRangeExpression: "--export-range", goalSeekExpressions: "--goal-seek",
  recalc: "--recalc", solve: "--solve", goalSeek: "--goal-seek", analysis: "--tool-test",
  resize: "--resize", resizeExpression: "--resize", toolTest: "--tool-test",
  perSheet: "-S", verbose: "-v", graphs: "--export-graphs", clipboard: "--clipboard"
} satisfies Record<keyof sdk.ConversionRequest, string>;

it("keeps every SDK conversion control assigned to a genuine CLI operation", () => {
  expect(Object.values(commandCoverage).every(operation => operation.length > 0)).toBe(true);
});
