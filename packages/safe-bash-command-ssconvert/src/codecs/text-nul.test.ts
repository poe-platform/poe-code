import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import type { Workbook } from "../workbook.js";
import { readText } from "./text.js";
import { writeConfigurableText, writePlainCsv } from "./text-export.js";

const context: CapabilityContext = {
  signal: new AbortController().signal, own() {}, inputFilename: "/nul.csv",
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 2, operations: 1000 },
};
const workbook = (value: string): Workbook => ({ sheets: [{ id: "s1", name: "Data", cells: [
  { row: 0, column: 0, value: { kind: "string", value } },
] }] });

// Calc strips NUL on CSV import and Gnumeric substitutes/truncates it. The
// requested preservation deliberately extends those native compatibility paths.
it.each([
  ["\0", "\0\n"], ["\0first", "\0first\n"], ["last\0", "last\0\n"],
  ["a\0\0z", "a\0\0z\n"], ["a\0,z", '"a\0,z"\n'],
  ['a\0"z', '"a\0""z"\n'], ["a\0\nz", '"a\0\nz"\n'],
  ["=1\0+1", "=1\0+1\n"],
])("preserves NUL in %j through both text exporters and CSV import", async (value, csv) => {
  for (const write of [writePlainCsv, writeConfigurableText]) {
    const warnings: string[] = [];
    const local = { ...context, async diagnostic(d: { message: string }) { warnings.push(d.message); } };
    const bytes = await write(workbook(value), [], local);
    expect(bytes).toEqual(new TextEncoder().encode(csv));
    const read = await readText(bytes, local);
    expect(read.sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value });
    expect(read.sheets[0]!.cells[0]!.formula).toBeUndefined();
    expect(warnings).toEqual([]);
  }
});

it.each(["UTF-8", "UTF-16LE", "ISO-8859-1"])("preserves decoded NUL through %s", async charset => {
  const value = "é\0,z";
  const bytes = await writeConfigurableText(workbook(value), [`charset=${charset}`], context);
  const read = await readText(bytes, context, charset);
  expect(read.sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value });
});

it("charges the entire NUL-containing field to the output byte limit", async () => {
  await expect(writePlainCsv(workbook("a\0z"), [], { ...context, limits: { ...context.limits, outputBytes: 3 } }))
    .rejects.toMatchObject({ code: "resource-limit" });
  expect(await writePlainCsv(workbook("a\0z"), [], { ...context, limits: { ...context.limits, outputBytes: 4 } }))
    .toEqual(Uint8Array.of(97, 0, 122, 10));
});

it("keeps pre-abort identity and input admission for NUL-containing CSV", async () => {
  const bytes = Uint8Array.of(97, 0, 122, 10);
  await expect(readText(bytes, { ...context, limits: { ...context.limits, inputBytes: 3 } }))
    .rejects.toMatchObject({ code: "resource-limit" });
  const controller = new AbortController(); controller.abort(false);
  await expect(readText(bytes, { ...context, signal: controller.signal })).rejects.toBe(false);
  await expect(writePlainCsv(workbook("a\0z"), [], { ...context, signal: controller.signal })).rejects.toBe(false);
});
