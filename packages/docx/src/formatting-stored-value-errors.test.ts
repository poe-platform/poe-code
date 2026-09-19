import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";

const rows = [
  ["font", "bold", '<w:b w:val="invalid"/>'],
  ["font", "underline", '<w:u w:val="invalid"/>'],
  ["font", "highlight_color", '<w:highlight w:val="invalid"/>'],
  ["font", "superscript", '<w:vertAlign w:val="invalid"/>'],
  ["font", "subscript", '<w:vertAlign w:val="invalid"/>'],
  ["format", "keep_with_next", '<w:keepNext w:val="invalid"/>'],
  ["format", "alignment", '<w:jc w:val="invalid"/>'],
  ["format", "line_spacing_rule", '<w:spacing w:line="1440" w:lineRule="invalid"/>'],
  ["format", "line_spacing", '<w:spacing w:line="1440" w:lineRule="invalid"/>'],
  ["font", "size", '<w:sz/>'],
  ["font", "highlight_color", '<w:highlight/>'],
  ["font", "superscript", '<w:vertAlign/>'],
  ["font", "subscript", '<w:vertAlign/>'],
  ["format", "alignment", '<w:jc/>']
] as const;
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["direct", "choice", "fallback", "process"] as const)
for (const [owner, property, markup] of rows) for (const route of ["model", "sdk", "cli"] as const)
it(`rejects malformed stored ${owner}.${property}${markup.includes("invalid") ? "" : " missing required value"} with a typed document error; ${route}; ${carrier}; ${kind}; strict=${strict}`, async () => {
  const wrapped = carrier === "direct" ? markup : carrier === "process" ? `<f:pass>${markup}</f:pass>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? markup : ""}</mc:Choice><mc:Fallback>${carrier === "fallback" ? markup : ""}</mc:Fallback></mc:AlternateContent>`;
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, `<w:p xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:stored-formatting-values" mc:Ignorable="f" mc:ProcessContent="f:pass"><w:pPr>${owner === "format" ? wrapped : ""}</w:pPr><w:r><w:rPr>${owner === "font" ? wrapped : ""}<w:i/></w:rPr><w:t>Retain 日本 עברית é 🌊</w:t></w:r><!--retain--><?policy keep?></w:p>`);
  const operations = [
    { operation: "model.document.Document.paragraphs.get", receiver: { resultHandle: "document" }, arguments: {}, resultHandle: "paragraphs" },
    ...(owner === "font" ? [
      { operation: "model.text.paragraph.Paragraph.runs.get", receiver: { resultHandle: "paragraphs", index: 0 }, arguments: {}, resultHandle: "runs" },
      { operation: "model.text.run.Run.font.get", receiver: { resultHandle: "runs", index: 0 }, arguments: {}, resultHandle: "font" }
    ] : [{ operation: "model.text.paragraph.Paragraph.paragraph_format.get", receiver: { resultHandle: "paragraphs", index: 0 }, arguments: {}, resultHandle: "format" }]),
    { operation: `model.${owner === "font" ? "text.run.Font" : "text.parfmt.ParagraphFormat"}.${property}.get`, receiver: { resultHandle: owner }, arguments: {} }
  ];
  if (route === "model") {
    const document = await api.Document(input, textContext), paragraph = document.paragraphs[0]!, before = document.part.blob;
    const view = owner === "font" ? paragraph.runs[0]!.font : paragraph.paragraph_format;
    expect(() => Reflect.get(view, property)).toThrow(api.InvalidDocumentError); expect(document.part.blob).toEqual(before);
  } else if (route === "sdk") await expect(api.applyStyleModelBatch(input, { version: 1, operations }, textContext)).rejects.toMatchObject({ code: "invalid-package" });
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/destination", new TextEncoder().encode("Retain destination"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec(`docx batch /input --ops-json '${JSON.stringify({ version: 1, operations })}' --dry-run --json`);
      expect(result.exitCode, result.stdout + result.stderr).toBe(1); expect(JSON.parse(result.stdout).errors[0].code).toBe("invalid-package");
      expect(await fs.readFile("/input")).toEqual(input); expect(new TextDecoder().decode(await fs.readFile("/destination"))).toBe("Retain destination");
    } finally { await shell.dispose(); }
  }
});
