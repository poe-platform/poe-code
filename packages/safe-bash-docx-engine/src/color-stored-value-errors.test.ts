import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["direct", "choice", "fallback", "process"] as const)
for (const member of ["rgb", "theme_color"] as const) for (const route of ["model", "sdk", "cli"] as const)
it(`rejects malformed stored color.${member} with a typed document error; ${route}; ${carrier}; ${kind}; strict=${strict}`, async () => {
  const markup = member === "rgb" ? '<w:color w:val="GGGGGG"/>' : '<w:color w:val="123ABC" w:themeColor="unmapped"/>';
  const wrapped = carrier === "direct" ? markup : carrier === "process" ? `<f:pass>${markup}</f:pass>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? markup : ""}</mc:Choice><mc:Fallback>${carrier === "fallback" ? markup : ""}</mc:Fallback></mc:AlternateContent>`;
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, `<w:p xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:stored-color-values" mc:Ignorable="f" mc:ProcessContent="f:pass"><w:r><w:rPr>${wrapped}<w:i/></w:rPr><w:t>Retain 日本 עברית é 🌊</w:t></w:r><!--retain--><?policy keep?></w:p>`);
  const operations = [
    { operation: "model.document.Document.paragraphs.get", receiver: { resultHandle: "document" }, arguments: {}, resultHandle: "paragraphs" },
    { operation: "model.text.paragraph.Paragraph.runs.get", receiver: { resultHandle: "paragraphs", index: 0 }, arguments: {}, resultHandle: "runs" },
    { operation: "model.text.run.Run.font.get", receiver: { resultHandle: "runs", index: 0 }, arguments: {}, resultHandle: "font" },
    { operation: "model.text.run.Font.color.get", receiver: { resultHandle: "font" }, arguments: {}, resultHandle: "color" },
    { operation: `model.dml.color.ColorFormat.${member}.get`, receiver: { resultHandle: "color" }, arguments: {} }
  ];
  if (route === "model") {
    const document = await api.Document(input, textContext), before = document.part.blob;
    expect(() => document.paragraphs[0]!.runs[0]!.font.color[member]).toThrow(api.InvalidDocumentError); expect(document.part.blob).toEqual(before);
  } else if (route === "sdk") await expect(api.applyStyleModelBatch(input, { version: 1, operations }, textContext)).rejects.toMatchObject({ code: "invalid-package" });
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec(`docx batch /input --ops-json '${JSON.stringify({ version: 1, operations })}' --dry-run --json`);
      expect(result.exitCode, result.stdout + result.stderr).toBe(1); expect(JSON.parse(result.stdout).errors[0].code).toBe("invalid-package"); expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
});
