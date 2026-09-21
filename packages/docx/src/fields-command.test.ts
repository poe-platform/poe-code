import { expect, expectTypeOf, it } from "vitest";
import { Volume } from "memfs";
import * as docx from "./index.js";
import { textContext, textFixture, run } from "../tests/fixtures/text.js";

async function command(bytes: Uint8Array, args: string[]) {
  const volume = Volume.fromJSON({ "/input.docx": Buffer.from(bytes), "/stdout": "" });
  let stderr = "";
  const result = await docx.createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({ args: args.map(s => new TextEncoder().encode(s)), cwd: "/", signal: textContext.signal,
    filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } }, stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(bytes) { volume.appendFileSync("/stdout", bytes); } }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
  expect(volume.readFileSync("/input.docx")).toEqual(Buffer.from(bytes));
  return { ...result, stderr, stdout: new Uint8Array(volume.readFileSync("/stdout") as Buffer) };
}
it("uses the field SDK for list, dry-run and pure binary publication", async () => {
  const bytes = await textFixture('<w:p><w:fldSimple w:instr=" MERGEFIELD Harbor ">' + run("Old") + '</w:fldSimple></w:p>');
  const list = await command(bytes, ["fields", "list", "input.docx", "--json"]);
  expect(list.exitCode).toBe(0);
  expect(JSON.parse(new TextDecoder().decode(list.stdout))).toMatchObject({ operation: "fields.list", data: await docx.inspectDocumentFields(bytes, {}, textContext), affected: 0 });
  const dry = await command(bytes, ["fields", "set", "input.docx", "--field", "1", "--result", "New", "--dry-run", "--json"]);
  expect(dry.exitCode).toBe(0);
  expect(JSON.parse(new TextDecoder().decode(dry.stdout))).toMatchObject({ affected: 1, data: { changed: true, dryRun: true, output: null } });
  const set = await command(bytes, ["fields", "set", "input.docx", "--field", "1", "--result", "New", "--output", "-"]);
  expect(set.exitCode).toBe(0);
  expect(set.stderr).toBe("");
  const archive = await docx.readDocumentArchive(set.stdout, textContext);
  expect(new TextDecoder().decode(archive.members.find(m => m.name === "word/document.xml")!.bytes)).toContain('<w:fldSimple w:instr=" MERGEFIELD Harbor "><w:r><w:t>New</w:t></w:r></w:fldSimple>');
});
it("advertises only bounded field listing and result editing", () => {
  const discovery = (...args: string[]) => docx.getDocxDiscovery(docx.parseDocxArguments(args.map(s => new TextEncoder().encode(s))))!;
  expect(discovery("schema", "fields", "list").data).toMatchObject({ operations: [{ id: "fields.list", support: "read" }] });
  expect(discovery("schema", "fields", "set").data).toMatchObject({ operations: [{ id: "fields.set", support: "edit" }] });
  expect(discovery("schema", "fields", "add").data).toMatchObject({ operations: [{ id: "fields.add", support: "edit" }] });
  expect(discovery("schema", "fields", "add").data).toMatchObject({ operations: [{ result: { oneOf: [{ properties: { data: { properties: { changes: { items: { properties: { kind: { enum: ["insert", "replace"] } } } } } } } }, {}] } }] });
  expect(discovery("help", "fields", "set").human).toContain("Never execute");
  expect(discovery("help", "fields", "set").human).not.toContain("--run ");
  expect(discovery("schema", "fields", "list").data).toMatchObject({ operations: [{ input: { properties: { field: { type: "integer", minimum: 1 } } } }] });
});
it.each(["simple", "complex"])("preserves empty %s cache formatting through direct CLI flags", async form => {
  const cache = '<w:r><w:rPr><w:i/></w:rPr></w:r>';
  const field = form === "simple"
    ? '<w:fldSimple w:instr=" PAGE " w:fldLock="on">' + cache + '</w:fldSimple>'
    : '<w:r><w:fldChar w:fldCharType="begin" w:fldLock="on"/><w:instrText> PAGE </w:instrText><w:fldChar w:fldCharType="separate"/></w:r>' + cache + '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
  const bytes = await textFixture(`<w:p>${field}</w:p>`);
  const result = await command(bytes, ["fields", "set", "input.docx", "--field", "1", "--result", "8", "--output", "-"]);
  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  const archive = await docx.readDocumentArchive(result.stdout, textContext);
  const xml = new TextDecoder().decode(archive.members.find(member => member.name === "word/document.xml")!.bytes);
  expect(xml).toContain('<w:r><w:rPr><w:i/></w:rPr><w:t');
  expect(xml).toContain('>8</w:t></w:r>');
  expect(xml).toContain('w:fldLock="on"');
  expect(xml).toContain(form === "simple" ? 'w:instr=" PAGE "' : '<w:instrText> PAGE </w:instrText>');
});
it.each([
  ["fields", "add", "--kind", "PAGE", "--result", "4", "--update", "false"],
  ["toc", "add", "--levels", "2-4", "--title", "Contents"],
  ["captions", "add", "--label", "Figure", "--text", "River"],
  ["captions", "add", "--label", "Plate A", "--text", "River", "--static", "true"]
])("publishes typed field structure flags through the command engine: %j", async (...args) => {
  const bytes = await textFixture(`<w:p>${run("Start")}</w:p>`);
  const result = await command(bytes, [...args, "input.docx", "--paragraph", "1", "--output", "-"]);
  expect(result.exitCode, result.stderr).toBe(0);
  const fields = await docx.inspectDocumentFields(result.stdout, {}, textContext);
  expect(fields.items).toHaveLength(args.includes("--static") ? 0 : 1);
});
it.each(["--run", "--image", "--link", "--bookmark", "--control", "--revision", "--shape"])("rejects inapplicable field selector %s", flag => {
  expect(() => docx.parseDocxArguments(["fields", "list", "input.docx", flag, "1"].map(s => new TextEncoder().encode(s)))).toThrow();
});

it("excludes inapplicable selectors from both typed field list surfaces", () => {
  expectTypeOf<docx.DocxOperationArguments<"fields.list">>().not.toHaveProperty("bookmark");
  expectTypeOf<docx.DocxBatchArgumentMap["fields.list"]>().not.toHaveProperty("bookmark");
  expectTypeOf<docx.DocxBatchArgumentMap["fields.add"]>().not.toHaveProperty("output");
  expectTypeOf<docx.DocxBatchArgumentMap["toc.set"]>().not.toHaveProperty("inPlace");
});

it("retains operation envelopes for declared field batch items", () => {
  expectTypeOf<docx.DocxBatchItemMap["fields.add"]>().toEqualTypeOf<{ readonly operation: "fields.add"; readonly arguments: docx.DocxBatchArgumentMap["fields.add"] }>();
  expectTypeOf<docx.DocxBatchItemMap["fields.set"]>().toEqualTypeOf<{ readonly operation: "fields.set"; readonly arguments: docx.DocxBatchArgumentMap["fields.set"] }>();
  expectTypeOf<docx.DocxBatchItemMap["toc.add"]>().toEqualTypeOf<{ readonly operation: "toc.add"; readonly arguments: docx.DocxBatchArgumentMap["toc.add"] }>();
  expectTypeOf<docx.DocxBatchItemMap["toc.set"]>().toEqualTypeOf<{ readonly operation: "toc.set"; readonly arguments: docx.DocxBatchArgumentMap["toc.set"] }>();
  expectTypeOf<docx.DocxBatchItemMap["captions.add"]>().toEqualTypeOf<{ readonly operation: "captions.add"; readonly arguments: docx.DocxBatchArgumentMap["captions.add"] }>();
  expectTypeOf<docx.DocxBatchItemMap["captions.set"]>().toEqualTypeOf<{ readonly operation: "captions.set"; readonly arguments: docx.DocxBatchArgumentMap["captions.set"] }>();
});

it("edits TOC levels through direct flags while preserving quoted style operands and unselected fields", async () => {
  const retained = '<w:fldSimple w:instr=" TOC ">' + run("Retained contents 19") + '</w:fldSimple>';
  const bytes = await textFixture('<w:p><w:fldSimple w:instr=" TOC \\t &quot;Heading Coast\\&quot; \\o literal,1&quot; \\o &quot;1-3&quot; " w:dirty="off" w:fldLock="on">' + run("Selected contents 8") + '</w:fldSimple>' + retained + '</w:p>');
  const result = await command(bytes, ["toc", "set", "input.docx", "--field", "1", "--levels", "2-5", "--update", "false", "--output", "-"]);
  expect(result.exitCode, result.stderr).toBe(0);
  const fields = (await docx.inspectDocumentFields(result.stdout, {}, textContext)).items;
  expect(fields[0]).toMatchObject({ instruction: ' TOC \\t "Heading Coast\\" \\o literal,1" \\o "2-5" ', result: "Selected contents 8", update: false, locked: true });
  const archive = await docx.readDocumentArchive(result.stdout, textContext);
  expect(new TextDecoder().decode(archive.members.find(m => m.name === "word/document.xml")!.bytes)).toContain(retained);
});
