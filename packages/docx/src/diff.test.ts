import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as sdk from "./index.js";
import { createDocumentFixture } from "../tests/fixtures/documents.js";
import { readArchive } from "./archive.js";
import { writeArchive } from "./archive-write.js";
import { DocumentBudget } from "./budget.js";
import { createDocxInspectionCommandEngine } from "./inspection-command.js";

const limits = { maxArchiveBytes: 65536, maxEntryBytes: 32768, maxTotalBytes: 65536, maxMembers: 40, maxPathBytes: 256, maxDepth: 32, maxExtraBytes: 1024, maxCommentBytes: 1024, maxRetainedBytes: 32000000, chunkSize: 4096 };
const context = { limits, signal: new AbortController().signal };
const encoder = new TextEncoder();
const decoder = new TextDecoder();
async function repack(input: Uint8Array, change: (name: string, bytes: Uint8Array) => Uint8Array = (_, bytes) => bytes) {
  const archive = await readArchive(input, context);
  const chunks: Uint8Array[] = [];
  await writeArchive({ members: [...archive.members].reverse().map(member => ({ ...member, modified: new Date("2024-02-03T00:00:00Z"), bytes: change(member.name, new Uint8Array(member.bytes)) })), comment: encoder.encode("Repacked original package") }, { async write(bytes) { chunks.push(new Uint8Array(bytes)); } }, { compression: "deflate", order: "input" }, context);
  return new Uint8Array(Buffer.concat(chunks));
}
function xmlChange(part: string, from: string, to: string) {
  return (name: string, bytes: Uint8Array) => name === part ? encoder.encode(decoder.decode(bytes).split(from).join(to)) : bytes;
}
async function compare(left: Uint8Array, right: Uint8Array, mode: "parts" | "xml" | "text" | "structure", scope: sdk.DocumentDiffScope = mode === "parts" || mode === "xml" ? "package" : "body", budget?: DocumentBudget) {
  return sdk.compareDocument(left, right, { ...context, budget: budget ?? new DocumentBudget({}, context.signal, async () => {}) }, { mode, scope });
}
it("compares payloads independently of compression, order, dates and ZIP comments", async () => {
  const { bytes } = await createDocumentFixture("museum");
  const before = new Uint8Array(bytes), right = await repack(bytes);
  expect(right).not.toEqual(bytes);
  for (const mode of ["parts", "xml", "text", "structure"] as const)
    expect(await compare(bytes, right, mode)).toMatchObject({ equal: true, mode, differences: [] });
  expect(bytes).toEqual(before);
});
it("ignores XML prefix and attribute spelling order but retains whitespace, order and IDs", async () => {
  const { bytes } = await createDocumentFixture("garden");
  const renamed = await repack(bytes, (name, data) => name === "word/document.xml" ? encoder.encode(decoder.decode(data).split("xmlns:w=").join("xmlns:z=").split("w:").join("z:")) : data);
  expect((await compare(bytes, renamed, "xml")).equal).toBe(true);
  expect((await compare(bytes, renamed, "parts")).equal).toBe(false);
  for (const [from, to] of [["Community", " Community"], ["12240", "12241"]]) {
    const changed = await repack(bytes, xmlChange("word/document.xml", from!, to!));
    expect((await compare(bytes, changed, "xml")).equal).toBe(false);
  }
  const changedId = await repack(bytes, xmlChange("_rels/.rels", 'Id="rDocument"', 'Id="rOther"'));
  expect((await compare(bytes, changedId, "xml")).equal).toBe(false);
});
it("detects binary image changes without claiming text differences", async () => {
  const { bytes } = await createDocumentFixture("museum");
  const changed = await repack(bytes, (name, data) => { if (name.endsWith(".bmp")) data[data.length - 3] = data[data.length - 3]! ^ 1; return data; });
  for (const mode of ["parts", "xml"] as const) expect((await compare(bytes, changed, mode)).differences.some(d => d.part.endsWith(".bmp"))).toBe(true);
  expect((await compare(bytes, changed, "text")).equal).toBe(true);
});
it("selects annotation stories and preserves logical table structure", async () => {
  const { bytes } = await createDocumentFixture("observatory");
  const archive = await readArchive(bytes, context);
  const comment = archive.members.find(m => m.name === "word/comments.xml")!;
  const original = decoder.decode(comment.bytes);
  const changed = await repack(bytes, (name, data) => name === comment.name ? encoder.encode(original.split("</w:t>").join(" amended</w:t>")) : data);
  expect((await compare(bytes, changed, "text", "body")).equal).toBe(true);
  expect((await compare(bytes, changed, "text", "comments")).equal).toBe(false);
  const table = await repack(bytes, xmlChange("word/comments.xml", 'w:w="1800"', 'w:w="1900"'));
  expect((await compare(bytes, table, "text", "comments")).equal).toBe(true);
  expect((await compare(bytes, table, "structure", "comments")).equal).toBe(false);
});
it("requires explicit scope, bounds differences and accounts both packages", async () => {
  const { bytes } = await createDocumentFixture("museum");
  await expect(sdk.compareDocument(bytes, bytes, context, { mode: "parts" } as sdk.DocumentDiffOptions)).rejects.toMatchObject({ code: "usage" });
  const budget = new DocumentBudget({}, context.signal);
  await compare(bytes, bytes, "parts", "package", budget);
  expect(budget.usage.compressedInput).toBe(bytes.length * 2);
  const changed = await repack(bytes, xmlChange("word/document.xml", "12240", "12241"));
  await expect(compare(bytes, changed, "parts", "package", new DocumentBudget({ matches: 0 }, context.signal))).rejects.toMatchObject({ code: "limit-exceeded" });
});
it("returns equality, difference and trouble through explicit memfs inputs without writes", async () => {
  const { bytes } = await createDocumentFixture("museum");
  const different = await repack(bytes, xmlChange("word/document.xml", "12240", "12241"));
  const volume = Volume.fromJSON({ "/left.docx": Buffer.from(bytes), "/equal.docx": Buffer.from(await repack(bytes)), "/different.docx": Buffer.from(different), "/broken.docx": "not a package" });
  const before = volume.toJSON();
  for (const [right, status, ok] of [["equal", 0, true], ["different", 1, true], ["broken", 2, false], ["missing", 2, false]] as const) {
    let stdout = "";
    const result = await createDocxInspectionCommandEngine({ limits }).execute({ args: ["diff", "/left.docx", `/${right}.docx`, "--mode", "parts", "--scope", "package", "--json"].map(v => encoder.encode(v)), cwd: "/", filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } }, stdin: { [Symbol.asyncIterator]() { return { async next(): Promise<IteratorResult<Uint8Array>> { throw new Error("Undeclared stdin"); } }; } }, stdout: { async write(data) { stdout += decoder.decode(data); } }, stderr: { async write() {} }, signal: context.signal });
    expect(result.exitCode).toBe(status);
    expect(JSON.parse(stdout)).toMatchObject({ operation: "diff", ok, affected: 0, ...(ok ? { data: { equal: status === 0 } } : { data: null }) });
  }
  expect(volume.toJSON()).toEqual(before);
});
it("preserves semantic XML order, adjacent character data and meaningful attribute values", async () => {
  const { bytes } = await createDocumentFixture("garden");
  const reorder = await repack(bytes, xmlChange("word/document.xml", 'w:top="1440" w:right="1440"', 'w:right="1440" w:top="1440"'));
  expect((await compare(bytes, reorder, "xml")).equal).toBe(true);
  const cdata = await repack(bytes, xmlChange("word/document.xml", "Community garden handbook", "Community <![CDATA[garden]]> handbook"));
  expect((await compare(bytes, cdata, "xml")).equal).toBe(true);
  const order = await repack(bytes, xmlChange("word/document.xml", '<w:keepNext/><w:spacing w:after="120"/>', '<w:spacing w:after="120"/><w:keepNext/>'));
  expect((await compare(bytes, order, "xml")).equal).toBe(false);
  const namespace = await repack(bytes, xmlChange("word/document.xml", "urn:original:equipment", "urn:original:replacement"));
  expect((await compare(bytes, namespace, "xml")).equal).toBe(false);
});
it("compares logical run splits and detects selected image and annotation identity changes", async () => {
  const { bytes } = await createDocumentFixture("observatory");
  const split = await repack(bytes, xmlChange("word/document.xml", "Rail reference", 'Rail</w:t></w:r><w:r><w:t> reference'));
  expect((await compare(bytes, split, "text")).equal).toBe(true);
  expect((await compare(bytes, split, "structure")).equal).toBe(true);
  expect((await compare(bytes, split, "xml")).equal).toBe(false);
  const annotation = await repack(bytes, xmlChange("word/document.xml", 'w:bookmarkStart w:id="5"', 'w:bookmarkStart w:id="6"'));
  expect((await compare(bytes, annotation, "structure")).equal).toBe(false);
  const { bytes: imageBytes } = await createDocumentFixture("museum");
  const changed = await repack(imageBytes, (name, data) => { if (name.endsWith(".bmp")) data[data.length - 3] = data[data.length - 3]! ^ 1; return data; });
  expect((await compare(imageBytes, changed, "structure")).equal).toBe(false);
});
it("discovers the supported comparison schema and F48 capabilities", () => {
  const schema = sdk.getDocxDiscovery(sdk.validateDocxInvocation({ operation: "schema", inputs: [], options: { operation: "diff" } }));
  expect(schema!.data).toMatchObject({ operations: [{ id: "diff", support: "read", featureIds: ["F48"] }] });
  const capabilities = sdk.getDocxDiscovery(sdk.validateDocxInvocation({ operation: "capabilities", inputs: [], options: {} }));
  expect(capabilities!.data).toMatchObject({ features: expect.arrayContaining([expect.objectContaining({ id: "F48", level: "read" })]) });
});
it("isolates nested text-box stories from body structure and accounts combined retention", async () => {
  const { textFixture, paragraph, textContext } = await import("../tests/fixtures/text.js");
  const wp = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
  const bytes = await textFixture(`<w:p><w:r><w:drawing><wp:wsp xmlns:wp="${wp}"><wp:txbx><wp:txbxContent>${paragraph("Boxed observation")}</wp:txbxContent></wp:txbx></wp:wsp></w:drawing></w:r></w:p>`);
  const changed = await repack(bytes, xmlChange("word/document.xml", "Boxed observation", "Boxed amendment"));
  expect((await compare(bytes, changed, "structure", "body")).equal).toBe(true);
  expect((await compare(bytes, changed, "structure", "text-boxes")).equal).toBe(false);
  const budget = new DocumentBudget({}, textContext.signal, async () => {});
  await compare(bytes, bytes, "parts", "package", budget);
  const ceiling = Math.floor(budget.usage.retainedBytes * 0.75);
  await expect(compare(bytes, bytes, "parts", "package", new DocumentBudget({ retainedBytes: ceiling }, context.signal, async () => {}))).rejects.toMatchObject({ code: "limit-exceeded" });
});
it("resolves standard QName-valued XML attributes without rewriting arbitrary values", async () => {
  const { textFixture } = await import("../tests/fixtures/text.js");
  const bytes = await textFixture('<w:p xmlns:i="http://www.w3.org/2001/XMLSchema-instance" xmlns:x="urn:original:typed" i:type="x:record"><w:r><w:t>Typed record</w:t></w:r></w:p>');
  const changed = await repack(bytes, (name, data) => name === "word/document.xml" ? encoder.encode(decoder.decode(data).split('xmlns:x="urn:original:typed"').join('xmlns:y="urn:original:typed"').split('i:type="x:record"').join('i:type="y:record"')) : data);
  expect((await compare(bytes, changed, "xml")).equal).toBe(true);
});
it("rejects incompatible comparison scope before reading inputs and permits one explicit stdin", async () => {
  let reads = 0, output = "";
  const request = { cwd: "/", filesystem: { async readFile() { reads++; throw new Error("Must not acquire invalid request"); } }, stdin: { async *[Symbol.asyncIterator]() { yield new Uint8Array(); } }, stdout: { async write(bytes: Uint8Array) { output += decoder.decode(bytes); } }, stderr: { async write() {} }, signal: context.signal };
  const engine = createDocxInspectionCommandEngine({ limits });
  const result = await engine.execute({ ...request, args: ["diff", "left", "right", "--mode", "parts", "--scope", "body", "--json"].map(v => encoder.encode(v)) });
  expect(result.exitCode).toBe(2);
  expect(reads).toBe(0);
  expect(JSON.parse(output).errors[0].code).toBe("usage");
  const { bytes } = await createDocumentFixture("garden");
  output = "";
  const stdin = await engine.execute({ ...request, args: ["diff", "-", "right", "--scope", "package", "--json"].map(v => encoder.encode(v)), filesystem: { async readFile() { return bytes; } }, stdin: { async *[Symbol.asyncIterator]() { yield bytes; } } });
  expect(stdin.exitCode).toBe(0);
  expect(JSON.parse(output).data.equal).toBe(true);
});
it("reports bounded added and removed parts with the correct source fingerprints", async () => {
  const { bytes: original } = await createDocumentFixture("garden");
  const bytes = await repack(original, xmlChange("[Content_Types].xml", "</Types>", '<Default Extension="xml" ContentType="application/xml"/></Types>'));
  const archive = await readArchive(bytes, context);
  const chunks: Uint8Array[] = [];
  await writeArchive({ ...archive, members: [...archive.members, { name: "original-extra.xml", bytes: encoder.encode('<extra xmlns="urn:original:extra">Observation</extra>'), directory: false, modified: new Date("2024-02-03T00:00:00Z") }] }, { async write(bytes) { chunks.push(new Uint8Array(bytes)); } }, { compression: "store", order: "name" }, context);
  const right = new Uint8Array(Buffer.concat(chunks)), before = new Uint8Array(right);
  const added = await compare(bytes, right, "parts");
  expect(added.differences).toHaveLength(1);
  expect(added.differences[0]).toMatchObject({ kind: "add", part: "/original-extra.xml", left: null, right: { kind: "part", value: { part: "/original-extra.xml" } } });
  const removed = await compare(right, bytes, "parts");
  expect(removed.differences[0]).toMatchObject({ kind: "remove", right: null, left: added.differences[0]!.right });
  expect(right).toEqual(before);
});
it("publishes matching CLI and SDK scope constraints and typed comparison failures", () => {
  for (const transport of ["cli", "sdk"] as const) {
    const schema = sdk.getDocxOperationSchema("diff", transport);
    expect(schema.required).toContain("scope");
    expect(schema.allOf?.[0]?.oneOf).toHaveLength(2);
  }
});
it("documents required comparison scope without advertising a body default", () => {
  const help = sdk.getDocxDiscovery(sdk.validateDocxInvocation({ operation: "help", inputs: [], options: { operation: "diff" } }))!;
  expect(help.human).toContain("Required --scope");
  expect(help.human).not.toContain("Scope defaults to");
});
