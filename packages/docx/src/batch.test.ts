import { expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { executeDocumentBatch } from "./batch.js";
import { createDocxInspectionCommandEngine } from "./inspection-command.js";
import { DocumentBudget } from "./budget.js";
import { extractDocumentText } from "./text.js";
import { inspectDocumentFields } from "./fields.js";
import { inspectDocumentRevisions } from "./revisions.js";
import { inspectDocumentTable } from "./table-read.js";
import { inspectDocumentImages } from "./images.js";
import { inspectDocumentProperties } from "./document-properties.js";
import { readDocumentArchive } from "./admission.js";
import { paragraph, run, textContext, textFixture } from "../tests/fixtures/text.js";
import { rasterPng } from "../tests/fixtures/raster.js";

const pipeline = [
  { id: "cache", operation: "fields.set", arguments: { field: 1, result: "{{survey}}" } },
  { id: "placeholder", operation: "text.replace", arguments: { find: "{{survey}}", with: "Harbor count", all: true } },
  { id: "grid", operation: "tables.add", arguments: { paragraph: 1, rows: 1, cols: 2 } },
  { id: "value", operation: "tables.set", arguments: { table: 1, cell: "A1", text: "Harbor count" } },
  { id: "read", operation: "tables.get", arguments: { table: 1 } },
];
async function fieldInput() {
  return textFixture(`<w:p><w:fldSimple w:instr=" MERGEFIELD survey ">${run("Unfilled")}</w:fldSimple></w:p>`);
}
function capture() {
  const volume = Volume.fromJSON({ "/out": "" });
  const write = vi.fn(async (bytes: Uint8Array) => { volume.appendFileSync("/out", bytes); });
  return { volume, write, context: { ...textContext, encoding: { order: "input" as const, compression: "store" as const }, stdout: { write } } };
}
it("resolves field, placeholder and table operations in staged order and publishes once", async () => {
  const input = await fieldInput(), sink = capture();
  const budget = new DocumentBudget({}, textContext.signal);
  const result = await executeDocumentBatch(input, { version: 1, operations: pipeline }, { output: "-" }, { ...sink.context, budget });
  const bytes = new Uint8Array(sink.volume.readFileSync("/out") as Buffer);
  expect(result.results.map(item => item.id)).toEqual(pipeline.map(item => item.id));
  expect(result.results.at(-1)).toMatchObject({ operation: "tables.get", affected: 0, data: { item: { details: { cells: [{ text: "Harbor count" }, { text: "" }] } } } });
  expect((await inspectDocumentFields(bytes, {}, textContext)).items[0]?.result).toBe("Harbor count");
  expect((await inspectDocumentTable(bytes, { table: 1 }, textContext)).item.details.columns).toBe(2);
  expect(budget.usage.compressedInput).toBe(input.length);
  expect(budget.usage.batchOperations).toBe(5);
  expect(result.publication?.output?.bytes).toBe(bytes.length);
  expect(result.publication).toMatchObject({ changes: [{ kind: "replace" }, { kind: "replace" }, { kind: "add" }, { kind: "replace" }] });
  expect(sink.write).toHaveBeenCalledTimes(1);
});
it("retains exact image bytes and metadata through later text edits", async () => {
  const input = await textFixture(paragraph("Coastal report")), sink = capture(), image = rasterPng();
  const file = { kind: "bytes", base64: btoa(String.fromCharCode(...image)) };
  const result = await executeDocumentBatch(input, { version: 1, operations: [
    { operation: "images.add", arguments: { paragraph: 1, file, alt: "Survey marker" } },
    { operation: "properties.set", arguments: { name: "title", value: "Coastal inventory" } },
    { operation: "properties.get", arguments: { name: "title" } },
    { operation: "images.list", arguments: {} },
    { operation: "text.replace", arguments: { find: "Coastal report", with: "Confirmed report", all: true } },
  ] }, { output: "-" }, sink.context);
  expect(result.results[2]?.data).toMatchObject({ item: { name: "core:title" } });
  expect(Object.keys(result.results[3]?.data as object)).toEqual(["items"]);
  const bytes = new Uint8Array(sink.volume.readFileSync("/out") as Buffer);
  expect((await readDocumentArchive(bytes, textContext)).members.some(member => member.bytes.length === image.length && member.bytes.every((value, index) => value === image[index]))).toBe(true);
  expect((await inspectDocumentImages(bytes, { operation: "images.list" }, textContext)).items).toHaveLength(1);
  expect(JSON.stringify(await inspectDocumentProperties(bytes, { name: "title" }, textContext))).toContain("Coastal inventory");
  expect((await extractDocumentText(bytes, textContext)).text).toContain("Confirmed report");
});
it("discards earlier edits when the last semantic selection fails", async () => {
  const input = await fieldInput(), sink = capture();
  await expect(executeDocumentBatch(input, { version: 1, operations: [...pipeline, { id: "invalid", operation: "tables.set", arguments: { table: 999, cell: "A1", text: "Invalid" } }] }, { output: "-" }, sink.context)).rejects.toMatchObject({ operationIndex: 5, operationId: "invalid" });
  expect(sink.write).not.toHaveBeenCalled();
  expect(sink.volume.readFileSync("/out").length).toBe(0);
  expect((await inspectDocumentFields(input, {}, textContext)).items[0]?.result).toBe("Unfilled");
});
it("charges inserted nodes cumulatively rather than resetting per operation", async () => {
  const input = await textFixture(paragraph("Anchor")), sink = capture();
  const budget = new DocumentBudget({ insertedNodes: 13 }, textContext.signal);
  await expect(executeDocumentBatch(input, { version: 1, operations: [
    { operation: "paragraphs.add", arguments: { paragraph: 1, text: "First" } },
    { operation: "paragraphs.add", arguments: { paragraph: 1, text: "Second" } },
  ] }, { output: "-" }, { ...sink.context, budget })).rejects.toMatchObject({ code: "limit-exceeded", operationIndex: 1 });
  expect(sink.write).not.toHaveBeenCalled();
});
it("runs the same ordered batch from CLI JSON with one document acquisition", async () => {
  const input = await fieldInput(), volume = Volume.fromJSON({ "/stdout": "", "/stderr": "" });
  const readFile = vi.fn(async () => input);
  const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
    args: ["batch", "input.docx", "--ops-json", JSON.stringify({ version: 1, operations: pipeline }), "--dry-run", "--json"].map(value => new TextEncoder().encode(value)),
    cwd: "/", filesystem: { readFile }, signal: textContext.signal,
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(bytes) { volume.appendFileSync("/stdout", bytes); } },
    stderr: { async write(bytes) { volume.appendFileSync("/stderr", bytes); } },
  });
  expect(result.exitCode, volume.readFileSync("/stderr", "utf8") as string).toBe(0);
  const data = JSON.parse(volume.readFileSync("/stdout", "utf8") as string);
  expect(data).toMatchObject({ operation: "batch", ok: true, affected: 4, data: { results: pipeline.map(item => ({ id: item.id, operation: item.operation, ok: true })), publication: { dryRun: true, output: null } } });
  expect(readFile).toHaveBeenCalledTimes(1);
});
it("keeps preexisting input and forced output bytes when the CLI last step fails", async () => {
  const input = await fieldInput(), volume = Volume.fromJSON({ "/input.docx": Buffer.from(input), "/result.docx": "Existing report", "/stdout": "", "/stderr": "" });
  const readFile = vi.fn(async (path: string) => new Uint8Array(volume.readFileSync(path) as Buffer));
  const writeFile = vi.fn(async () => { throw new Error("Failed batches cannot write files"); });
  const operations = [...pipeline, { id: "missing", operation: "tables.set", arguments: { table: 999, cell: "A1", text: "Invalid" } }];
  const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
    args: ["batch", "input.docx", "--ops-json", JSON.stringify({ version: 1, operations }), "--output", "result.docx", "--force", "--json"].map(value => new TextEncoder().encode(value)),
    cwd: "/", filesystem: { readFile, writeFile, async lstat() { return { type: "file", size: input.length, mode: 420, mtimeMs: 0, ctimeMs: 0, atimeMs: 0 }; } }, signal: textContext.signal,
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(bytes) { volume.appendFileSync("/stdout", bytes); } },
    stderr: { async write(bytes) { volume.appendFileSync("/stderr", bytes); } },
  });
  expect(result.exitCode).toBe(1);
  expect(JSON.parse(volume.readFileSync("/stdout", "utf8") as string)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "missing-selection", operationIndex: 5, operationId: "missing" }] });
  expect(volume.readFileSync("/input.docx")).toEqual(Buffer.from(input));
  expect(volume.readFileSync("/result.docx", "utf8")).toBe("Existing report");
  expect(writeFile).not.toHaveBeenCalled();
});
it.each([
  { operation: "text.replace", arguments: { find: "x", with: "y", all: true, unknown: true } },
  { operation: "eval", arguments: { source: "throw Error()" } },
  { operation: "text.replace", arguments: { find: "x", with: () => "y", all: true } },
])("rejects invalid final syntax before publication or document parsing: %j", async last => {
  const sink = capture(), budget = new DocumentBudget({}, textContext.signal);
  await expect(executeDocumentBatch(new Uint8Array([0]), { version: 1, operations: [...pipeline, last] }, { output: "-" }, { ...sink.context, budget })).rejects.toMatchObject({ code: "usage" });
  expect(budget.usage.compressedInput).toBe(0);
  expect(sink.write).not.toHaveBeenCalled();
});
it("charges matches across successful operations before final publication", async () => {
  const input = await textFixture(paragraph("First")), sink = capture(), budget = new DocumentBudget({ matches: 1 }, textContext.signal);
  await expect(executeDocumentBatch(input, { version: 1, operations: [
    { operation: "text.replace", arguments: { find: "First", with: "Second", all: true } },
    { operation: "text.replace", arguments: { find: "Second", with: "Third", all: true } },
  ] }, { output: "-" }, { ...sink.context, budget })).rejects.toMatchObject({ code: "limit-exceeded", operationIndex: 1 });
  expect(sink.write).not.toHaveBeenCalled();
});
it("charges table expansion across operations", async () => {
  const input = await textFixture(paragraph("Anchor")), sink = capture(), budget = new DocumentBudget({ tableCells: 2 }, textContext.signal);
  await expect(executeDocumentBatch(input, { version: 1, operations: [
    { operation: "tables.add", arguments: { paragraph: 1, rows: 1, cols: 2 } },
    { operation: "tables.add", arguments: { paragraph: 1, rows: 1, cols: 2 } },
  ] }, { output: "-" }, { ...sink.context, budget })).rejects.toMatchObject({ code: "limit-exceeded", operationIndex: 1 });
  expect(sink.write).not.toHaveBeenCalled();
});
it("accounts for each inserted table cell once", async () => {
  const input = await textFixture(paragraph("Anchor")), sink = capture(), budget = new DocumentBudget({ tableCells: 10 }, textContext.signal);
  await executeDocumentBatch(input, { version: 1, operations: [
    { operation: "tables.add", arguments: { paragraph: 1, rows: 1, cols: 2 } },
    { operation: "tables.add", arguments: { paragraph: 1, rows: 1, cols: 2 } },
  ] }, { dryRun: true }, { ...sink.context, budget });
  expect(budget.usage.tableCells).toBe(4);
});
it("emits the current generation after multiple staged replacements", async () => {
  const input = await textFixture(paragraph("First")), sink = capture();
  const result = await executeDocumentBatch(input, { version: 1, operations: [
    { operation: "text.replace", arguments: { find: "First", with: "Second", all: true } },
    { operation: "text.replace", arguments: { find: "Second", with: "Third", all: true } },
  ] }, { dryRun: true }, sink.context);
  expect(result.results[1]?.locations[0]?.value.generation).toBe(2);
  expect(result.results[1]?.data).toMatchObject({ changes: [{ before: { value: { generation: 1 } }, after: { value: { generation: 2 } } }] });
});
it("does not require file identity for read-only CLI batches", async () => {
  const input = await textFixture(paragraph("Read without identity")), volume = Volume.fromJSON({ "/stdout": "" });
  const lstat = vi.fn(async () => { throw Object.assign(new Error("Identity unavailable"), { code: "ENOTSUP" }); });
  const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
    args: ["batch", "input.docx", "--ops-json", JSON.stringify({ version: 1, operations: [{ operation: "text.get", arguments: {} }] }), "--json"].map(value => new TextEncoder().encode(value)),
    cwd: "/", filesystem: { async readFile() { return input; }, lstat }, signal: textContext.signal,
    stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write(bytes) { volume.appendFileSync("/stdout", bytes); } }, stderr: { async write() {} },
  });
  expect(result.exitCode).toBe(0);
  expect(lstat).not.toHaveBeenCalled();
});
it("rejects option accessors without invoking caller functions", async () => {
  const sink = capture(), getter = vi.fn(() => "-");
  const options = Object.defineProperty({}, "output", { enumerable: true, get: getter });
  await expect(executeDocumentBatch(new Uint8Array([0]), { version: 1, operations: pipeline }, options, sink.context)).rejects.toMatchObject({ code: "usage" });
  expect(getter).not.toHaveBeenCalled();
});
it("does not charge a property match twice", async () => {
  const input = await textFixture(paragraph("Report")), sink = capture();
  await executeDocumentBatch(input, { version: 1, operations: [{ operation: "properties.set", arguments: { name: "title", value: "Single" } }] }, { output: "-" }, sink.context);
  const bytes = new Uint8Array(sink.volume.readFileSync("/out") as Buffer), budget = new DocumentBudget({ matches: 1 }, textContext.signal);
  const result = await executeDocumentBatch(bytes, { version: 1, operations: [{ operation: "properties.get", arguments: { name: "title" } }] }, {}, { ...sink.context, budget });
  expect(result.results).toHaveLength(1);
  expect(budget.usage.matches).toBe(1);
});
it("uses explicitly supplied outer tracking metadata through the SDK", async () => {
  const input = await textFixture(paragraph("First")), sink = capture();
  await executeDocumentBatch(input, { version: 1, operations: [{ operation: "text.replace", arguments: { find: "First", with: "Second", all: true, trackChanges: true } }] },
    { output: "-", author: "Surveyor", timestamp: "2026-01-02T03:04:05Z" }, sink.context);
  const bytes = new Uint8Array(sink.volume.readFileSync("/out") as Buffer);
  expect((await inspectDocumentRevisions(bytes, {}, textContext)).items).toEqual(expect.arrayContaining([expect.objectContaining({ author: "Surveyor", timestamp: "2026-01-02T03:04:05Z" })]));
});
it("reads literal dash image paths through VFS instead of consuming stdin", async () => {
  const input = await textFixture(paragraph("Marker")), image = rasterPng();
  const volume = Volume.fromJSON({ "/input.docx": Buffer.from(input), "/-": Buffer.from(image), "/stdout": "", "/stderr": "" });
  const paths: string[] = [];
  const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
    args: ["batch", "input.docx", "--ops-json", JSON.stringify({ version: 1, operations: [{ operation: "images.add", arguments: { paragraph: 1, file: { kind: "vfs", path: "-", capability: "command" } } }] }), "--dry-run"].map(value => new TextEncoder().encode(value)),
    cwd: "/", filesystem: { async readFile(path) { paths.push(path); return new Uint8Array(volume.readFileSync(path) as Buffer); } }, signal: textContext.signal,
    stdin: { [Symbol.asyncIterator]() { return { async next(): Promise<IteratorResult<Uint8Array>> { throw new Error("Literal paths cannot read stdin"); } }; } },
    stdout: { async write(bytes) { volume.appendFileSync("/stdout", bytes); } }, stderr: { async write(bytes) { volume.appendFileSync("/stderr", bytes); } },
  });
  expect(result.exitCode).toBe(0);
  expect(paths).toEqual(["/input.docx", "/-"]);
});
