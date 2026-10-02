import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { readPackage } from "../tests/assertions.js";
import { textContext } from "../tests/fixtures/text.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["direct", "choice", "fallback", "process"])
for (const route of ["sdk", "cli", "sdk-batch", "cli-batch", "sdk-model-batch", "cli-model-batch"])
it(`creates paragraph shading with contract black foreground across routes; ${route}; ${carrier}; ${kind}; strict=${strict}`, async () => {
  const property = '<w:keepNext/>', wrap = carrier === "direct" ? property : carrier === "process" ? `<f:pass>${property}</f:pass>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? property : ""}</mc:Choice><mc:Fallback>${carrier === "fallback" ? property : ""}</mc:Fallback></mc:AlternateContent>`;
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, `<w:p xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:shading-default" mc:Ignorable="f" mc:ProcessContent="f:pass"><w:pPr>${wrap}</w:pPr><w:r><w:rPr><w:i/></w:rPr><w:t>Retain 日本 עברית é 🌊</w:t></w:r><!--retain--><?policy keep?></w:p>`);
  const parts = readPackage(input);
  const volume = Volume.fromJSON({ "/out": "" }), sink = { async write(bytes: Uint8Array) { volume.appendFileSync("/out", bytes); } }, shading = { fill: "aabbcc", pattern: "pct25" } as const;
  const operations = route.includes("model") ? [{ operation: "model.document.Document.paragraphs.get", receiver: { resultHandle: "document" }, arguments: {}, resultHandle: "paragraphs" }, { operation: "paragraphs.format.set", receiver: { resultHandle: "paragraphs", index: 0 }, arguments: { shading } }] : [{ operation: "paragraphs.set", arguments: { paragraph: 1, shading } }], batch = { version: 1, operations };
  if (route === "sdk") await api.editDocumentParagraphs(input, { operation: "paragraphs.set", options: { paragraph: 1, shading, output: "-" } }, { ...textContext, stdout: sink, encoding: { order: "input", compression: "store" } });
  else if (route === "sdk-batch") await api.executeDocumentBatch(input, batch, { output: "-" }, { ...textContext, stdout: sink, encoding: { order: "input", compression: "store" } });
  else if (route === "sdk-model-batch") { const applied = await api.applyStyleModelBatch(input, batch, textContext); expect(applied.affected).toBe(1); await applied.save(sink); }
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const command = route === "cli" ? `docx paragraphs set /input --paragraph 1 --shading-json '${JSON.stringify(shading)}' --output /out --json` : `docx batch /input --ops-json '${JSON.stringify(batch)}' --output /out --json`;
      const r = await shell.exec(command); expect(r.exitCode, r.stdout + r.stderr).toBe(0); expect(JSON.parse(r.stdout).affected).toBe(1);
      volume.writeFileSync("/out", await fs.readFile("/out")); expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(volume.readFileSync("/out") as Buffer), saved = readPackage(output), document = await api.Document(output, textContext);
  const nodes = (node: api.XmlElement): api.XmlElement[] => [node, ...node.children.flatMap(nodes)];
  const xml = new api.DocumentXmlEditor(document.part.blob), shade = nodes(xml.root).filter(node => node.namespace === xml.root.namespace && node.localName === "shd");
  expect(shade).toHaveLength(1); expect(Object.fromEntries(shade[0]!.attributes.filter(a => a.namespace === xml.root.namespace).map(a => [a.localName, a.value]))).toEqual({ fill: "AABBCC", color: "000000", val: "pct25" });
  expect(document.paragraphs[0]!.paragraph_format.keep_with_next).toBe(true); expect(document.paragraphs[0]!.runs[0]!.italic).toBe(true); expect(document.paragraphs[0]!.text).toBe("Retain 日本 עברית é 🌊");
  for (const [name, bytes] of parts) if (name !== document.part.partname.toString().slice(1)) expect(saved.get(name), name).toEqual(bytes);
});
