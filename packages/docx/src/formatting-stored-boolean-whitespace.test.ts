import { expect, it } from "vitest";
import { Volume } from "memfs";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const font = { all_caps: "caps", bold: "b", complex_script: "cs", cs_bold: "bCs", cs_italic: "iCs", double_strike: "dstrike", emboss: "emboss", hidden: "vanish", imprint: "imprint", italic: "i", math: "oMath", no_proof: "noProof", outline: "outline", rtl: "rtl", shadow: "shadow", small_caps: "smallCaps", snap_to_grid: "snapToGrid", spec_vanish: "specVanish", strike: "strike", web_hidden: "webHidden" };
const paragraph = { keep_together: "keepLines", keep_with_next: "keepNext", widow_control: "widowControl", page_break_before: "pageBreakBefore" };
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const [owner, flags] of [["font", font], ["format", paragraph]] as const)
for (const [property, tag] of Object.entries(flags)) for (const value of [true, false])
for (const route of ["model", "sdk", "cli"] as const)
it(`reads legal XML boolean whitespace for ${owner}.${property}=${value}; ${route}; ${kind}; strict=${strict}`, async () => {
  const markup = `<w:${tag} w:val=" &#x9;${value}&#xA; "/>`;
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, `<w:p><w:pPr>${owner === "format" ? markup : ""}</w:pPr><w:r><w:rPr>${owner === "font" ? markup : ""}</w:rPr><w:t>Retain 日本 עברית é 🌊</w:t></w:r><!--retain--><?policy keep?></w:p>`);
  const memory = Volume.fromJSON({ "/out": "" }), sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/out", bytes); } };
  const operations = [
    { operation: "model.document.Document.paragraphs.get", receiver: { resultHandle: "document" }, arguments: {}, resultHandle: "paragraphs" },
    ...(owner === "font" ? [
      { operation: "model.text.paragraph.Paragraph.runs.get", receiver: { resultHandle: "paragraphs", index: 0 }, arguments: {}, resultHandle: "runs" },
      { operation: "model.text.run.Run.font.get", receiver: { resultHandle: "runs", index: 0 }, arguments: {}, resultHandle: "font" }
    ] : [{ operation: "model.text.paragraph.Paragraph.paragraph_format.get", receiver: { resultHandle: "paragraphs", index: 0 }, arguments: {}, resultHandle: "format" }]),
    { operation: `model.${owner === "font" ? "text.run.Font" : "text.parfmt.ParagraphFormat"}.${property}.get`, receiver: { resultHandle: owner }, arguments: {} }
  ];
  if (route === "model") {
    const d = await api.Document(input, textContext), p = d.paragraphs[0]!, view = owner === "font" ? p.runs[0]!.font : p.paragraph_format;
    expect(Reflect.get(view, property)).toBe(value); await d.save(sink);
  } else if (route === "sdk") { const b = await api.applyStyleModelBatch(input, { version: 1, operations }, textContext); expect(b.results.at(-1)!.value).toBe(value); await b.save(sink); }
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const r = await shell.exec(`docx batch /input --ops-json '${JSON.stringify({ version: 1, operations })}' --dry-run --json`);
      expect(r.exitCode, r.stdout + r.stderr).toBe(0); expect(JSON.parse(r.stdout).data.results.at(-1).data).toBe(value); expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
    return;
  }
  expect(readPackage(new Uint8Array(memory.readFileSync("/out") as Buffer))).toEqual(readPackage(input));
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const token of [" on ", " off ", "\u00a0true\u00a0", "\u20031\u2003"])
it(`rejects nonboolean schema whitespace spelling ${JSON.stringify(token)}; ${kind}; strict=${strict}`, async () => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, `<w:p><w:r><w:rPr><w:b w:val="${token}"/></w:rPr><w:t>Retain</w:t></w:r></w:p>`);
  const d = await api.Document(input, textContext); expect(() => d.paragraphs[0]!.runs[0]!.font.bold).toThrowError(api.InvalidDocumentError);
});
