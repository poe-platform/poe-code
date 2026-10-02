import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";

for (const strict of [false, true]) for (const type of ["paragraph", "character", "table", "numbering"] as const) for (const carrier of ["direct", "choice", "fallback", "process"] as const) for (const route of ["model", "sdk", "shell", "sdk-batch", "shell-batch"] as const)
it(`${route} removes named ${type} definition through ${carrier} while retaining references and content; strict=${strict}`, async () => {
  const selected = `<w:style w:type="${type}" w:styleId="selected"><w:name w:val="Original Selected"/><w:rPr><w:b/></w:rPr></w:style>`, inactive = `<w:style w:type="${type}" w:styleId="inactive"><w:name w:val="Inactive Selected"/></w:style>`;
  const wrapped = carrier === "direct" ? selected : carrier === "process" ? `<f:pass>${selected}</f:pass><f:opaque f:identity="original">${inactive}</f:opaque>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? selected : inactive}</mc:Choice><mc:Fallback>${carrier === "fallback" ? selected : inactive}</mc:Fallback></mc:AlternateContent>`;
  const styles = `<w:styles xmlns:w="${w}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:removal" mc:Ignorable="f" mc:ProcessContent="f:pass"><w:style w:type="${type}" w:styleId="default" w:default="1"><w:name w:val="Original Default"/></w:style>${wrapped}<!--retain--><?audit retain?></w:styles>`;
  const input = await textFixture(`<w:p><w:pPr>${type === "paragraph" ? '<w:pStyle w:val="selected"/>' : ""}<w:keepNext/></w:pPr><w:r><w:rPr>${type === "character" ? '<w:rStyle w:val="selected"/>' : ""}<w:i/></w:rPr><w:t>Unchanged é 日本 עברית 🌊</w:t></w:r></w:p>`, { styles: { kind: "styles", xml: styles } }, strict), volume = Volume.fromJSON({ "/out": "" }), sink = { async write(bytes: Uint8Array) { volume.appendFileSync("/out", bytes); } }, context = { ...textContext, encoding: { order: "input" as const, compression: "store" as const }, stdout: sink }, batch = { version: 1, operations: [{ operation: "styles.remove", arguments: { name: "Original Selected" } }] };
  if (route === "model") { const document = await api.Document(input, textContext); document.styles.at("Original Selected").delete(); await document.save(sink); }
  else if (route === "sdk") await api.editDocumentStyles(input, { operation: "styles.remove", name: "Original Selected", output: "-" } as unknown as api.StyleEditOptions, context);
  else if (route === "sdk-batch") await api.executeDocumentBatch(input, batch, { output: "-" }, context);
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try { const result = await shell.exec(route === "shell" ? "docx styles remove /input --name 'Original Selected' --output - > /out" : `docx batch /input --ops-json '${JSON.stringify(batch)}' --output - > /out`); expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(await fs.readFile("/input")).toEqual(input); volume.writeFileSync("/out", await fs.readFile("/out")); } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(volume.readFileSync("/out") as Buffer), before = readPackage(input), after = readPackage(output); assertPackageLinks(after); expect(after.size).toBe(before.size);
  for (const [name, bytes] of before) if (name !== "word/styles.xml") expect(after.get(name), name).toEqual(bytes);
  const document = await api.Document(output, textContext); expect(document.styles.has("Original Selected")).toBe(false); expect(document.styles.has("Original Default")).toBe(true); expect(document.paragraphs[0]!.text).toBe("Unchanged é 日本 עברית 🌊"); expect(document.paragraphs[0]!.paragraph_format.keep_with_next).toBe(true); expect(document.paragraphs[0]!.runs[0]!.italic).toBe(true);
  if (type === "paragraph") expect(document.paragraphs[0]!.style?.name).toBe("Original Default"); if (type === "character") expect(document.paragraphs[0]!.runs[0]!.style?.name).toBe("Original Default");
  const xml = new TextDecoder().decode(after.get("word/styles.xml")); expect(xml).not.toContain(selected); expect(xml).toContain('w:styleId="default"'); expect(xml.split("<!--retain-->")).toHaveLength(2); expect(xml.split("<?audit retain?>")).toHaveLength(2); if (carrier !== "direct") expect(xml.split(inactive)).toHaveLength(2);
});
