import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";

const carriers = ["direct", "choice", "fallback", "process"] as const;
for (const strict of [false, true]) for (const outer of carriers) for (const inner of carriers) for (const action of ["set", "remove"] as const) for (const route of ["model", "sdk", "shell"] as const)
it(`${route} ${action === "set" ? "preserves" : "rejects discarding"} inherited style scope through ${outer}/${inner}; strict=${strict}`, async () => {
  const wrap = (content: string, carrier: typeof carriers[number], identity: string) => carrier === "direct" ? content : carrier === "process" ? `<f:pass>${content}</f:pass><f:opaque f:identity="${identity}"/>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}"${carrier === "fallback" ? ` f:identity="${identity}"` : ""}>${carrier === "choice" ? content : ""}</mc:Choice><mc:Fallback${carrier === "choice" ? ` f:identity="${identity}"` : ""}>${carrier === "fallback" ? content : ""}</mc:Fallback></mc:AlternateContent>`;
  const definition = `<w:style w:type="paragraph" w:styleId="selected" f:identity="selected"><w:name w:val="Original Selected"/><w:rPr>${wrap('<w:b/>', inner, "inner")}</w:rPr><!--retain--><?audit retain?></w:style>`;
  const styles = `<w:styles xmlns:w="${w}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:inherited-style-scope" mc:Ignorable="f" mc:ProcessContent="f:pass">${wrap(definition, outer, "outer")}</w:styles>`;
  const input = await textFixture('<w:p><w:r><w:t>Unchanged é 日本 עברית 🌊</w:t></w:r></w:p>', { styles: { kind: "styles", xml: styles } }, strict), volume = Volume.fromJSON({ "/out": "" });
  if (route === "model") {
    const document = await api.Document(input, textContext), selected = document.styles.at("Original Selected") as api.ParagraphStyle;
    if (action === "remove") { const before = document.styles.part.blob; expect(() => selected.delete()).toThrow(); expect(document.styles.part.blob).toEqual(before); }
    else { selected.font.bold = false; await document.save({ async write(bytes) { volume.appendFileSync("/out", bytes); } }); }
  } else if (route === "sdk") {
    const operation = api.editDocumentStyles(input, { operation: action === "set" ? "styles.set" : "styles.remove", name: "Original Selected", ...(action === "set" ? { bold: false } : {}), output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } } });
    if (action === "remove") await expect(operation).rejects.toMatchObject({ code: "unsupported-edit" }); else await operation;
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try { const result = await shell.exec(`docx styles ${action} /input --name 'Original Selected' ${action === "set" ? "--bold false " : ""}--output - > /out`); expect(result.exitCode, result.stdout + result.stderr).toBe(action === "set" ? 0 : 1); if (action === "remove") expect(result.stderr).toContain("unsupported-edit"); expect(await fs.readFile("/input")).toEqual(input); volume.writeFileSync("/out", await fs.readFile("/out")); } finally { await shell.dispose(); }
  }
  if (action === "remove") { expect(volume.readFileSync("/out")).toHaveLength(0); return; }
  const output = new Uint8Array(volume.readFileSync("/out") as Buffer), before = readPackage(input), after = readPackage(output); assertPackageLinks(after); expect(after.size).toBe(before.size);
  for (const [name, bytes] of before) if (name !== "word/styles.xml") expect(after.get(name), name).toEqual(bytes);
  const document = await api.Document(output, textContext); expect((document.styles.at("Original Selected") as api.ParagraphStyle).font.bold).toBe(false); expect(document.paragraphs[0]!.text).toBe("Unchanged é 日本 עברית 🌊");
  const xml = new TextDecoder().decode(after.get("word/styles.xml")); for (const token of ['f:identity="selected"', "<!--retain-->", "<?audit retain?>", ...(outer === "direct" ? [] : ['f:identity="outer"']), ...(inner === "direct" ? [] : ['f:identity="inner"'])]) expect(xml.split(token), token).toHaveLength(2);
});
