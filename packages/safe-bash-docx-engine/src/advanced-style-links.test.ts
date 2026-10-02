import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { w, textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";

for (const strict of [false, true]) for (const route of ["model-batch", "sdk-batch", "shell-batch"] as const)
 it(`${route} executes required style link rebinding and default-type assignment without losing other definitions; strict=${strict}`, async () => {
  const styles = `<w:styles xmlns:w="${w}"><w:style w:type="paragraph" w:styleId="p0"><w:name w:val="Harbor"/><w:link w:val="c0"/><w:rPr><w:b/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="p1" w:default="1"><w:name w:val="Base"/><w:link w:val="c1"/></w:style><w:style w:type="character" w:styleId="c0"><w:name w:val="First character"/><w:link w:val="p0"/></w:style><w:style w:type="character" w:styleId="c1"><w:name w:val="Second character"/><w:link w:val="p1"/><w:rPr><w:i/></w:rPr></w:style><!--retained style annotation--><?review keep?></w:styles>`;
  const input = await textFixture('<w:p><w:pPr><w:pStyle w:val="p0"/></w:pPr><w:r><w:t>Original</w:t></w:r></w:p>', { styles: { kind: "styles", xml: styles } }, strict);
  const batch = { version: 1, operations: [{ operation: "model.document.Document.styles.get", receiver: { resultHandle: "document" }, arguments: {}, resultHandle: "styles" }, { operation: "model.styles.styles.Styles.__getitem__.call", receiver: { resultHandle: "styles" }, arguments: { key: "Harbor" }, resultHandle: "style" }, { operation: "styles.links.set", receiver: { resultHandle: "style" }, arguments: { linkedStyle: "Second character", defaultForType: true } }] };
  const memory = Volume.fromJSON({ "/out": "" }), sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/out", bytes); } };
  if (route === "model-batch") { const result = await api.applyStyleModelBatch(input, batch, textContext); await result.save(sink); }
  else if (route === "sdk-batch") await api.executeDocumentBatch(input, batch, { output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: sink });
  else { const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
   try { const result = await shell.exec(`docx batch /input --ops-json '${JSON.stringify(batch)}' --output - > /out`); expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(await fs.readFile("/input")).toEqual(input); memory.writeFileSync("/out", await fs.readFile("/out")); } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/out") as Buffer), before = readPackage(input), after = readPackage(output); assertPackageLinks(after); for (const [name, bytes] of before) if (name !== "word/styles.xml") expect(after.get(name), name).toEqual(bytes);
  const definitions = (await api.inspectDocumentStyles(output, {}, textContext)).styles, info = (name: string) => definitions.find(s => s.name === name)!;
  expect([info("Harbor").linkedStyle, info("Second character").linkedStyle, info("Base").linkedStyle, info("First character").linkedStyle]).toEqual(["Second character", "Harbor", null, null]); expect(info("Harbor").defaultForType).toBe(true); expect(info("Base").defaultForType).toBe(false); expect(info("Harbor").direct.bold).toBe(true); expect(info("Second character").direct.italic).toBe(true); expect((await api.Document(output, textContext)).paragraphs[0]!.text).toBe("Original");
  const xml = new TextDecoder().decode(after.get("word/styles.xml")); for (const retained of ["<!--retained style annotation-->", "<?review keep?>"]) expect(xml.split(retained)).toHaveLength(2);
 });
