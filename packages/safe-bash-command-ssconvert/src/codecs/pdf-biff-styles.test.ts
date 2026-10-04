import type { ImportedValue } from "../workbook.js";
import { expect, it } from "vitest";
import { suppliedDefaultFont } from "safe-bash-pdf-engine";
import type { CapabilityContext } from "../contracts.js";
import { createBiffWriter, readBiff } from "./biff.js";
import { writePdf } from "./pdf.js";
import { pdfText } from "./pdf-text.test-support.js";
import { cellPrintStyle } from "../rendering/print/cell-style.js";
const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" }, fonts: { async resolve() { return suppliedDefaultFont().bytes; } },
  limits: { inputBytes: 1000000, outputBytes: 4000000, workbookWork: 4000000, cells: 100, sheets: 4, operations: 1000 } };
for (const revision of [7, 8] as const) {
  it(`prints ordinary BIFF${revision} materialized styles`, async () => {
    const bytes = await createBiffWriter(revision)({ sheets: [{ id: "s", name: "Data", cells: [
      { row: 0, column: 0, value: { kind: "string", value: "BIFF" } }
    ] }] }, [], context);
    const book = await readBiff(bytes, context), before = structuredClone(book);
    const { pdf, runs } = await pdfText(await writePdf(book, [], context));
    expect(pdf.getPageCount()).toBe(1);
    expect(runs.some(run => run.text === "BIFF")).toBe(true);
    expect(book).toEqual(before);
  });
  it(`does not ignore unknown BIFF${revision} provenance or unsupported style effects`, async () => {
    const bytes = await createBiffWriter(revision)({ sheets: [{ id: "s", name: "Data", cells: [
      { row: 0, column: 0, value: { kind: "string", value: "BIFF" } }
    ] }] }, [], context);
    const style = (await readBiff(bytes, context)).sheets[0]!.cells[0]!.style!;
    expect(() => cellPrintStyle({ ...style, biff: { xf: 15, revision, effect: "unknown" } }, () => {})).toThrow("styled or merged cells");
    expect(() => cellPrintStyle({ ...style, unknown: true }, () => {})).toThrow("styled or merged cells");
    const gnumeric = style.gnumeric as Record<string, ImportedValue>;
    const children = (gnumeric.children as Record<string, ImportedValue>[]).map(node => ({ ...node, attributes: (node.attributes as Record<string, ImportedValue>[]).map(a => a.name === "Underline" ? { ...a, value: "1" } : a) }));
    expect(() => cellPrintStyle({ ...style, gnumeric: { ...gnumeric, children } }, () => {})).toThrow("styled or merged cells");
  });
}
