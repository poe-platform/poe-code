import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";

// Retain the initial removal matrix's malformed simultaneous paragraph/run
// usage as explicit validation/rejection witnesses, separately from valid edits.
for (const strict of [false, true]) for (const type of ["paragraph", "character", "table", "numbering"] as const) for (const carrier of ["direct", "choice", "fallback", "process"] as const) for (const route of ["sdk", "shell"] as const)
it(`${route} rejects preexisting mismatched ${type} style usage in ${carrier}; strict=${strict}`, async () => {
  const selected = `<w:style w:type="${type}" w:styleId="selected"><w:name w:val="Original Selected"/><w:rPr><w:b/></w:rPr></w:style>`, inactive = `<w:style w:type="${type}" w:styleId="inactive"><w:name w:val="Inactive Selected"/></w:style>`, wrapped = carrier === "direct" ? selected : carrier === "process" ? `<f:pass>${selected}</f:pass><f:opaque f:identity="original">${inactive}</f:opaque>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? selected : inactive}</mc:Choice><mc:Fallback>${carrier === "fallback" ? selected : inactive}</mc:Fallback></mc:AlternateContent>`;
  const input = await textFixture('<w:p><w:pPr><w:pStyle w:val="selected"/><w:keepNext/></w:pPr><w:r><w:rPr><w:rStyle w:val="selected"/><w:i/></w:rPr><w:t>Unchanged é 日本 עברית 🌊</w:t></w:r></w:p>', { styles: { kind: "styles", xml: `<w:styles xmlns:w="${w}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:removal" mc:Ignorable="f" mc:ProcessContent="f:pass"><w:style w:type="${type}" w:styleId="default" w:default="1"><w:name w:val="Original Default"/></w:style>${wrapped}<!--retain--><?audit retain?></w:styles>` } }, strict);
  const report = await api.validateDocument(input, textContext); expect(report.valid).toBe(false); expect(report.diagnostics.some(d => d.code === "style-type")).toBe(true);
  const volume = Volume.fromJSON({ "/out": "" });
  if (route === "sdk") await expect(api.editDocumentStyles(input, { operation: "styles.remove", name: "Original Selected", output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } } })).rejects.toMatchObject({ code: "invalid-package" });
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/dest", new TextEncoder().encode("Existing destination")); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try { const result = await shell.exec("docx styles remove /input --name 'Original Selected' --output /dest --force --json"); expect(result.exitCode).toBe(1); expect(JSON.parse(result.stdout).errors[0].code).toBe("invalid-package"); expect(await fs.readFile("/input")).toEqual(input); expect(new TextDecoder().decode(await fs.readFile("/dest"))).toBe("Existing destination"); } finally { await shell.dispose(); }
  }
  expect(volume.readFileSync("/out")).toHaveLength(0);
});
