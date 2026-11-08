import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createEngine } from "../engine.js";
import type { CapabilityContext } from "../contracts.js";
import type { Workbook } from "../workbook.js";
import { documentOutput, documentSheet } from "./document-export.js";
import { createLatexWriter } from "./latex.js";
import { writeRoff } from "./roff.js";
import { writeGlossary } from "./glossary.js";
import { latexFragmentHeader } from "./latex-syntax.js";
import { latexBorders } from "./latex-borders.js";

const context: CapabilityContext = {
  signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 10, operations: 1000, workbookWork: 1000000 }
};
const book: Workbook = { sheets: [{ id: "s", name: "Sheet1", cells: [{ row: 0, column: 0, value: { kind: "string", value: "é😀" } }] }] };
const glossary: Workbook = { sheets: [{ id: "g", name: "Terms", cells: [{ row: 0, column: 0, value: { kind: "string", value: "Term" } }] }] };

it("reports a supported capability error when a glossary clock is absent", async () => {
  await expect(writeGlossary(glossary, [], context)).rejects.toMatchObject({ code: "capability-denied", exitCode: 1 });
});

it("counts encoded UTF-8 output bytes and admits the exact boundary", () => {
  const out = documentOutput({ ...context, limits: { ...context.limits, outputBytes: 6 } }, "stress");
  out.put("é😀");
  expect([...out.finish()]).toEqual([195, 169, 240, 159, 152, 128]);
  expect(() => out.put("x")).toThrow("output bytes limit exceeded");
  const short = documentOutput({ ...context, limits: { ...context.limits, outputBytes: 5 } }, "stress");
  expect(() => short.put("é😀")).toThrow("output bytes limit exceeded");
});

it("border scans stop at the shared work limit before traversing oversized rows", () => {
  const out = documentOutput({ ...context, limits: { ...context.limits, workbookWork: 5 } }, "LaTeX");
  const borders = latexBorders(() => undefined, [], out.tick);
  expect(() => borders.rowVertical(0, 0, 1000000000)).toThrow("ssconvert LaTeX work limit exceeded");
});

it("border scans preserve cancellation raised during style lookup", () => {
  const controller = new AbortController(); const reason = Object.freeze({ borderCancellation: true });
  const out = documentOutput({ ...context, signal: controller.signal }, "LaTeX");
  const borders = latexBorders(() => { controller.abort(reason); return undefined; }, [], out.tick);
  let caught: unknown;
  try { borders.rowHorizontal(1, 0, 3, true); } catch (error) { caught = error; }
  expect(caught).toBe(reason);
});

it("extends LaTeX extents only for merges with nonempty corner cells", () => {
  const merges = [{ startRow: 4, startColumn: 3, endRow: 6, endColumn: 5 }];
  const empty = documentSheet({ id: "e", name: "Empty", cells: [], merges }, context, () => {}, true);
  expect(empty.extent).toEqual({ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 });
  const blank = documentSheet({ id: "e", name: "Empty", cells: [{ row: 4, column: 3, value: { kind: "blank" } }], merges }, context, () => {}, true);
  expect(blank.extent).toEqual(empty.extent);
  const full = documentSheet({ id: "e", name: "Empty", cells: [{ row: 4, column: 3, value: { kind: "string", value: "x" } }], merges }, context, () => {}, true);
  expect(full.extent).toEqual(merges[0]);
  const roff = documentSheet({ id: "e", name: "Empty", cells: [{ row: 4, column: 3, value: { kind: "string", value: "x" } }], merges }, context, () => {}, false);
  expect(roff.extent).toEqual({ startRow: 4, startColumn: 3, endRow: 4, endColumn: 3 });
});

it("exports an empty distant merge through injected memfs without expanding its table", async () => {
  const volume = Volume.fromJSON({ "/empty.gnumeric": '<Workbook xmlns="http://www.gnumeric.org/v10.dtd"><Sheets><Sheet><Name>Empty</Name><Cells/><MergedRegions><Merge>D5:F7</Merge></MergedRegions></Sheet></Sheets></Workbook>' });
  const engine = createEngine({ codecs: [], environment: context.environment, limits: context.limits,
    filesystem: {
      async read(uri, signal) { signal.throwIfAborted(); return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)]; },
      async write(uri, bytes, signal) { signal.throwIfAborted(); volume.writeFileSync(uri, bytes); }
    } });
  try {
    const result = await engine.convert({ input: { kind: "resource", uri: "/empty.gnumeric" }, destination: { kind: "resource", uri: "/empty.tex" }, exportType: "Gnumeric_html:latex_table" }, { signal: context.signal });
    expect(result.exitCode).toBe(0);
    expect(result.diagnostics).toEqual([]);
    expect(volume.readFileSync("/empty.tex", "utf8")).toBe(latexFragmentHeader + "\\\\\n");
    expect(Object.keys(volume.toJSON()).sort()).toEqual(["/empty.gnumeric", "/empty.tex"]);
  } finally { await engine.dispose(); }
});

it("visible table filters hidden rows while preserving hidden columns and formula errors", async () => {
  const axes: Workbook = { sheets: [{ id: "s", name: "Axes", rows: [{ index: 0, hidden: true }], columns: [{ index: 1, hidden: true }], cells: [
    { row: 0, column: 0, value: { kind: "string", value: "hidden" } },
    { row: 1, column: 0, value: { kind: "blank" }, formula: "=1/0", cachedResult: { kind: "error", value: "#DIV/0!" } },
    { row: 1, column: 1, value: { kind: "string", value: "é😀" } }
  ] }] };
  expect(new TextDecoder("latin1").decode(await createLatexWriter({ fragment: true, visibleRows: true })(axes, [], context))).toBe(latexFragmentHeader + "\\#DIV/0!\t&é?\\\\\n");
});

it("failed SDK document export preserves an existing destination and its namespace", async () => {
  const volume = Volume.fromJSON({ "/input.gnumeric": '<Workbook xmlns="http://www.gnumeric.org/v10.dtd"><Sheets><Sheet><Name>Empty</Name><Cells/></Sheet></Sheets></Workbook>', "/existing.tex": "keep" });
  const engine = createEngine({ codecs: [], environment: context.environment, limits: { ...context.limits, outputBytes: 1 },
    filesystem: {
      async read(uri, signal) { signal.throwIfAborted(); return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)]; },
      async write(uri, bytes, signal) { signal.throwIfAborted(); volume.writeFileSync(uri, bytes); }
    } });
  const before = volume.toJSON();
  try {
    await expect(engine.convert({ input: { kind: "resource", uri: "/input.gnumeric" }, destination: { kind: "resource", uri: "/existing.tex" }, exportType: "Gnumeric_html:latex" }, { signal: context.signal })).rejects.toMatchObject({ code: "resource-limit", message: "ssconvert LaTeX output bytes limit exceeded", exitCode: 1 });
    expect(volume.toJSON()).toEqual(before);
  } finally { await engine.dispose(); }
});

it.each([
  ["latex", createLatexWriter({})], ["table", createLatexWriter({ fragment: true })],
  ["visible", createLatexWriter({ fragment: true, visibleRows: true })], ["roff", writeRoff], ["glossary", writeGlossary]
] as const)("%s preserves a caller cancellation reason before emitting", async (_name, writer) => {
  const controller = new AbortController(); const reason = Object.freeze({ cancelled: true }); controller.abort(reason);
  await expect(writer(glossary, [], { ...context, signal: controller.signal, clock: { now: () => 0 } })).rejects.toBe(reason);
});

it.each([["latex", createLatexWriter({})], ["roff", writeRoff]] as const)("%s checks cancellation after an injected formatter settles", async (_name, writer) => {
  const controller = new AbortController(); const reason = Object.freeze({ duringFormatting: true });
  const numeric: Workbook = { sheets: [{ id: "n", name: "Numbers", cells: [{ row: 0, column: 0, value: { kind: "number", value: 2 }, format: "0.00" }] }] };
  await expect(writer(numeric, [], { ...context, signal: controller.signal, formatting: { async format() { controller.abort(reason); return "2.00"; } } })).rejects.toBe(reason);
});

it.each([["latex", createLatexWriter({})], ["roff", writeRoff]] as const)("%s enforces output and traversal work limits", async (_name, writer) => {
  await expect(writer(book, [], { ...context, limits: { ...context.limits, outputBytes: 1 } })).rejects.toMatchObject({ code: "resource-limit" });
  await expect(writer(book, [], { ...context, limits: { ...context.limits, workbookWork: 1 } })).rejects.toMatchObject({ code: "resource-limit" });
});
