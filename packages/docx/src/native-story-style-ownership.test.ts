import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";

const enc = (value: string) => new TextEncoder().encode(value), ref = (resultHandle: string) => ({ resultHandle });
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const owner of ["document.DocumentPart", "story.StoryPart", "hdrftr.HeaderPart", "hdrftr.FooterPart", "comments.CommentsPart"])
for (const route of ["sdk", "shell"])
it(`${route} rejects native ${owner} foreign style handles atomically; ${kind} strict=${strict}`, async () => {
  const fixture = await nativeStoryFixture(owner, strict, kind, "<w:p/>"), foreign = await nativeStoryFixture(owner, !strict, kind, '<w:p><w:r><w:t>Foreign ledger</w:t></w:r></w:p>');
  const memory = Volume.fromJSON({ "/input": Buffer.from(fixture.input), "/foreign": Buffer.from(foreign.input), "/output": "Retained destination" });
  const operations = [
    { operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "main" },
    ...(!fixture.main ? [{ operation: "model.parts.document.DocumentPart.part_related_by.call", receiver: ref("main"), arguments: { reltype: `${fixture.relationships}/${fixture.role}` }, resultHandle: "owner" }] : []),
    { operation: "model.package.Package.open.call", arguments: { pkgFile: { path: "/foreign", capability: "command" }, context: { vfs: "command" } }, resultHandle: "foreignPackage" },
    { operation: "model.package.Package.main_document_part.get", receiver: ref("foreignPackage"), arguments: {}, resultHandle: "foreignPart" },
    { operation: "model.parts.document.DocumentPart.document.get", receiver: ref("foreignPart"), arguments: {}, resultHandle: "foreignDocument" },
    { operation: "model.document.Document.styles.get", receiver: ref("foreignDocument"), arguments: {}, resultHandle: "foreignStyles" },
    { operation: "model.styles.styles.Styles.add_style.call", receiver: ref("foreignStyles"), arguments: { name: "Foreign Ledger", styleType: api.WD_STYLE_TYPE.PARAGRAPH }, resultHandle: "foreignStyle" },
    { operation: `model.parts.${owner}.get_style_id.call`, receiver: ref(fixture.main ? "main" : "owner"), arguments: { styleOrName: ref("foreignStyle"), styleType: api.WD_STYLE_TYPE.PARAGRAPH } }
  ], batch = { version: 1 as const, operations }, operationIndex = operations.length - 1;
  if (route === "sdk") {
    await expect(api.executeDocumentBatch(fixture.input, batch, { output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { memory.appendFileSync("/output", bytes); } }, binaryResolver: { capability: "command", async *open(path) { yield new Uint8Array(memory.readFileSync(path) as Buffer); } } })).rejects.toMatchObject({ name: "OwnershipError", code: "conflict", operationIndex });
  } else {
    const fs = new MemoryFileSystem(); for (const path of ["/input", "/foreign", "/output"]) await fs.writeFile(path, new Uint8Array(memory.readFileSync(path) as Buffer)); await fs.writeFile("/ops", enc(JSON.stringify(batch)));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec("docx batch /input --ops-file /ops --output /output --force --json"); expect(result.exitCode, result.stdout + result.stderr).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, affected: 0, data: null, errors: [{ code: "conflict", operationIndex }] });
      for (const path of ["/input", "/foreign", "/output"]) expect(await fs.readFile(path)).toEqual(new Uint8Array(memory.readFileSync(path) as Buffer));
    } finally { await shell.dispose(); }
  }
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(fixture.input)); expect(memory.readFileSync("/foreign")).toEqual(Buffer.from(foreign.input)); expect(memory.readFileSync("/output", "utf8")).toBe("Retained destination");
});
