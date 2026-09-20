import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const route of ["native", "sdk-style", "sdk-create", "sdk-batch", "cli-style", "cli-create", "cli-model"] as const)
it(`retains unselected dangling style fallback during unrelated style allocation; ${route}; ${kind}; strict=${strict}`, async () => {
  const parts = readPackage(await textFixture('<w:p><w:pPr><w:pStyle w:val="Style1"/></w:pPr><w:r><w:rPr><w:rtl/></w:rPr><w:t>Retain 日本 עברית é 🌊</w:t></w:r></w:p>', {
    styles: { kind: "styles", xml: `<w:styles xmlns:w="${w}"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><!--retained--><?audit retained?></w:styles>` }
  }, strict));
  if (kind === "dotx") parts.set("[Content_Types].xml", new TextEncoder().encode(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("document.main+xml", "template.main+xml")));
  const memory = Volume.fromJSON({ "/input": "", "/out": "" });
  const sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/out", bytes); } };
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), before = await api.Document(input, textContext);
  expect(before.paragraphs[0]!.style!.name).toBe("Normal");
  const publication = { ...textContext, encoding: { order: "input" as const, compression: "store" as const }, stdout: sink };
  const content = { version: 1 as const, blocks: [], styles: [{ name: "New coast", type: "paragraph" as const, bold: true }] };
  if (route === "native") {
    before.styles.add_style("New coast", api.WD_STYLE_TYPE.PARAGRAPH).font.bold = true;
    await before.save(sink);
  } else if (route === "sdk-style") await api.editDocumentStyles(input, { operation: "styles.add", name: "New coast", type: "paragraph", bold: true, output: "-" }, publication);
  else if (route === "sdk-create") await api.createDocument({ template: input, content }, { output: "-" }, publication);
  else if (route === "sdk-batch") await api.executeDocumentBatch(input, { version: 1, operations: [{ operation: "styles.add", arguments: { name: "New coast", type: "paragraph", bold: true } }] }, { output: "-" }, publication);
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/destination", new TextEncoder().encode("Retained destination"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const model = { version: 1, operations: [{ operation: "model.document.Document.styles.get", receiver: { resultHandle: "document" }, arguments: {}, resultHandle: "styles" }, { operation: "model.styles.styles.Styles.add_style.call", receiver: { resultHandle: "styles" }, arguments: { name: "New coast", styleType: { enum: "WD_STYLE_TYPE", name: "PARAGRAPH" } }, resultHandle: "added" }] };
      const command = route === "cli-style" ? "docx styles add /input --name 'New coast' --type paragraph --bold true" : route === "cli-create" ? `docx create --template /input --content-json '${JSON.stringify(content)}'` : `docx batch /input --ops-json '${JSON.stringify(model)}'`;
      const result = await shell.exec(command + " --output /destination --force --json");
      expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, errors: [] });
      expect(await fs.readFile("/input")).toEqual(input);
      memory.writeFileSync("/out", await fs.readFile("/destination"));
    } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/out") as Buffer), after = await api.Document(output, textContext);
  expect(after.paragraphs[0]!.style!.name).toBe("Normal");
  expect(after.styles.at("New coast").style_id).not.toBe("Style1");
  expect(after.paragraphs[0]!.text).toBe("Retain 日本 עברית é 🌊");
  expect(readPackage(output).get("word/document.xml")).toEqual(parts.get("word/document.xml"));
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});
