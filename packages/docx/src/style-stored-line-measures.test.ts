import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["direct", "choice", "fallback", "process"] as const)
for (const value of ["1in", "2.54cm", "25.4mm", "72pt", "6pc", "6pi"])
for (const route of ["model", "sdk", "cli"] as const)
it(`reads automatic universal style spacing ${value} as six lines; ${route}; ${carrier}; ${kind}; strict=${strict}`, async () => {
  const active = `<w:spacing w:line="${value}" w:lineRule="auto"/>`, inert = '<w:spacing w:line="wrong"/>';
  const content = carrier === "direct" ? active + `<f:opaque>${inert}</f:opaque>` : carrier === "process" ? `<f:pass>${active}</f:pass><f:opaque>${inert}</f:opaque>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? active : inert}</mc:Choice><mc:Fallback>${carrier === "fallback" ? active : inert}</mc:Fallback></mc:AlternateContent>`;
  const parts = readPackage(await textFixture('<w:p><w:r><w:t>Retain é 日本 עברית 🌊</w:t></w:r></w:p>', { styles: { kind: "styles", xml: `<w:styles xmlns:w="${w}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:style-measures" mc:Ignorable="f" mc:ProcessContent="f:pass"><w:style w:type="paragraph" w:styleId="Atlas"><w:name w:val="Atlas"/><w:pPr>${content}</w:pPr><w:rPr><w:i/></w:rPr></w:style><!--retain--><?policy keep?></w:styles>` } }, strict));
  if (kind === "dotx") parts.set("[Content_Types].xml", new TextEncoder().encode(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("document.main+xml", "template.main+xml")));
  const volume = Volume.fromJSON({ "/input": "", "/output": "" });
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { volume.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(volume.readFileSync("/input") as Buffer);
  if (route === "model") {
    const document = await api.Document(input, textContext), style = document.styles.at("Atlas") as api.ParagraphStyle;
    expect(style.paragraph_format.line_spacing).toBe(6); expect(style.font.italic).toBe(true);
    await document.save({ async write(bytes) { volume.appendFileSync("/output", bytes); } });
    expect(readPackage(new Uint8Array(volume.readFileSync("/output") as Buffer))).toEqual(parts);
  } else if (route === "sdk") {
    const data = await api.inspectDocumentStyles(input, {}, textContext);
    expect(data.styles[0]!.direct.lineSpacing).toBe(6); expect(data.styles[0]!.effective?.lineSpacing).toBe(6);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec("docx styles list /input --json"); expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      expect(JSON.parse(result.stdout).data.styles[0].direct.lineSpacing).toBe(6); expect(JSON.parse(result.stdout).data.styles[0].effective.lineSpacing).toBe(6);
      expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  expect(new Uint8Array(volume.readFileSync("/input") as Buffer)).toEqual(input);
});
