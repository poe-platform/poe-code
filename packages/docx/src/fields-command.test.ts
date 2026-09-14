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
  expect(discovery("schema", "fields", "add").data).toMatchObject({ operations: [{ id: "fields.add", support: "reject" }] });
  expect(discovery("help", "fields", "set").human).toContain("Never execute");
  expect(discovery("help", "fields", "set").human).not.toContain("--run ");
  expect(discovery("schema", "fields", "list").data).toMatchObject({ operations: [{ input: { properties: { field: { type: "integer", minimum: 1 } } } }] });
});
it.each(["--run", "--image", "--link", "--bookmark", "--control", "--revision", "--shape"])("rejects inapplicable field selector %s", flag => {
  expect(() => docx.parseDocxArguments(["fields", "list", "input.docx", flag, "1"].map(s => new TextEncoder().encode(s)))).toThrow();
});

it("excludes inapplicable selectors from both typed field list surfaces", () => {
  expectTypeOf<docx.DocxOperationArguments<"fields.list">>().not.toHaveProperty("bookmark");
  expectTypeOf<docx.DocxBatchArgumentMap["fields.list"]>().not.toHaveProperty("bookmark");
});
