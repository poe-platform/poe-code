import { expect, it, vi } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";
import * as text from "./text.js";

const cases = [
  { owner: "font", property: "bold", markup: '<w:b w:val="invalid"/>' },
  { owner: "font", property: "underline", markup: '<w:u w:val="invalid"/>' },
  { owner: "font", property: "size", markup: '<w:sz w:val="1.5"/>' },
  { owner: "format", property: "alignment", markup: '<w:jc w:val="invalid"/>' },
  { owner: "color", property: "rgb", markup: '<w:color w:val="GGGGGG"/>' }
] as const;
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["direct", "choice", "fallback", "process"])
for (const scenario of cases) for (const route of ["model", "sdk", "cli"])
it(`uses contract stable invalid-package for stored ${scenario.owner}.${scenario.property}; ${route}; ${carrier}; ${kind}; strict=${strict}`, async () => {
  const wrap = (xml: string) => carrier === "direct" ? xml : carrier === "process" ? `<f:pass>${xml}</f:pass>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? xml : ""}</mc:Choice><mc:Fallback>${carrier === "fallback" ? xml : ""}</mc:Fallback></mc:AlternateContent>`;
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, `<w:p xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:stable-error" mc:Ignorable="f" mc:ProcessContent="f:pass"><w:pPr>${scenario.owner === "format" ? wrap(scenario.markup) : ""}</w:pPr><w:r><w:rPr>${scenario.owner === "format" ? "" : wrap(scenario.markup)}</w:rPr><w:t>Retain 日本 עברית é 🌊</w:t></w:r><!--retain--><?policy keep?></w:p>`);
  const operations = [{ operation: "model.document.Document.paragraphs.get", receiver: { resultHandle: "document" }, arguments: {}, resultHandle: "paragraphs" },
    ...(scenario.owner === "format" ? [{ operation: "model.text.paragraph.Paragraph.paragraph_format.get", receiver: { resultHandle: "paragraphs", index: 0 }, arguments: {}, resultHandle: "format" }] : [{ operation: "model.text.paragraph.Paragraph.runs.get", receiver: { resultHandle: "paragraphs", index: 0 }, arguments: {}, resultHandle: "runs" }, { operation: "model.text.run.Run.font.get", receiver: { resultHandle: "runs", index: 0 }, arguments: {}, resultHandle: "font" }]),
    ...(scenario.owner === "color" ? [{ operation: "model.text.run.Font.color.get", receiver: { resultHandle: "font" }, arguments: {}, resultHandle: "color" }] : []),
    { operation: `model.${scenario.owner === "format" ? "text.parfmt.ParagraphFormat" : scenario.owner === "color" ? "dml.color.ColorFormat" : "text.run.Font"}.${scenario.property}.get`, receiver: { resultHandle: scenario.owner }, arguments: {} }];
  if (route === "model") {
    const document = await api.Document(input, textContext), paragraph = document.paragraphs[0]!, before = document.part.blob;
    const owner = scenario.owner === "format" ? paragraph.paragraph_format : scenario.owner === "color" ? paragraph.runs[0]!.font.color : paragraph.runs[0]!.font;
    let failure: unknown; try { Reflect.get(owner, scenario.property); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(api.InvalidDocumentError); expect(failure).toBeInstanceOf(api.DocumentError);
    expect(failure).toMatchObject({ code: "invalid-package" }); expect(document.part.blob).toEqual(before);
  } else if (route === "sdk") {
    const run = api.applyStyleModelBatch(input, { version: 1, operations }, textContext);
    await expect(run).rejects.toBeInstanceOf(api.InvalidDocumentError); await expect(run).rejects.toMatchObject({ code: "invalid-package" });
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/destination", new TextEncoder().encode("Original destination"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const r = await shell.exec(`docx batch /input --ops-json '${JSON.stringify({ version: 1, operations })}' --dry-run --json`);
      expect(r.exitCode, r.stdout + r.stderr).toBe(1); expect(JSON.parse(r.stdout)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "invalid-package" }] });
      expect(await fs.readFile("/input")).toEqual(input); expect(new TextDecoder().decode(await fs.readFile("/destination"))).toBe("Original destination");
    } finally { await shell.dispose(); }
  }
});

it("uses a declared semantic code for an uncoded post-acquisition failure", async () => {
  const { input } = await nativeStoryFixture("document.DocumentPart", false, "docx", '<w:p><w:r><w:t>Retain original</w:t></w:r></w:p>');
  const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
  const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
  const failure = vi.spyOn(text, "extractDocumentText").mockRejectedValueOnce(new Error("Original injected semantic failure"));
  try {
    const r = await shell.exec("docx text /input --json");
    expect(r.exitCode).toBe(1); expect(JSON.parse(r.stdout)).toMatchObject({ ok: false, errors: [{ code: "invalid-package" }] });
    expect(r.stderr).not.toContain("Original injected semantic failure"); expect(await fs.readFile("/input")).toEqual(input);
  } finally { failure.mockRestore(); await shell.dispose(); }
});
