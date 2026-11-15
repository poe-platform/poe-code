import assert from "node:assert/strict";
import { it } from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { PdfDocument } from "@poe-code/pdf-ast";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createSofficeCommand, createStoredZipArchive, runSofficeCli, runSofficeCliSync } from "./index.js";

for (const mode of ["sync", "async", "command"] as const)
for (const style of ["Normal", "Heading1", "Title", "Custom", "BodyCustom"])
for (const bottom of [false, true]) it(`preserves DOCX heading layout (${mode}, ${style}, bottom=${bottom})`, async () => {
  const heading = !["Normal", "BodyCustom"].includes(style);
  const prefix = '<w:p><w:r><w:t>Filler</w:t></w:r></w:p>'.repeat(bottom ? 32 : 0);
  const input = createStoredZipArchive({
    "word/styles.xml": new TextEncoder().encode('<w:styles xmlns:w="w"><w:style w:styleId="Custom"><w:name w:val="Heading 2"/></w:style><w:style w:styleId="BodyCustom"><w:name w:val="Body Text"/></w:style></w:styles>'),
    "word/document.xml": new TextEncoder().encode(`<w:document xmlns:w="w"><w:body>${prefix}<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r><w:t>Start </w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>Italic </w:t></w:r><w:r><w:rPr><w:i w:val="0"/></w:rPr><w:t>Reset ${"word ".repeat(18)}</w:t><w:br/><w:t>Break</w:t></w:r></w:p><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Boldbody</w:t></w:r></w:p></w:body></w:document>`)
  });
  const files = new Map([["/doc.docx", input]]), fs = new MemoryFileSystem();
  await fs.writeFile("/doc.docx", input);
  const args = ["--convert-to", "pdf", "/doc.docx"];
  const result = mode === "sync" ? runSofficeCliSync(args, files) : mode === "async" ? await runSofficeCli(args, files) : await createSofficeCommand().execute({command: "soffice", cwd: "/", env: {}, fs, ...createCommandArguments(args), signal: new AbortController().signal, stdin: toByteSource(""), stdout: {async write() {}}, stderr: {async write() {}}});
  assert.equal(result.exitCode, 0);
  const pdf = PdfDocument.load(mode === "command" ? await fs.readFile("/doc.pdf") : files.get("/doc.pdf")!);
  const glyphs = Array.from({length: pdf.pageCount}, (_, i) => pdf.getPage(i).evaluateDisplayList().glyphs).flat();
  const start = glyphs.find(g => g.unicode === "S")!;
  const italic = glyphs.find(g => g.unicode === "I")!;
  const reset = glyphs.find(g => g.unicode === "R")!;
  const breaks = glyphs.filter(g => g.unicode === "B");
  assert.equal(start.fontSize, heading ? 18 : 11);
  assert.equal(start.fontName, heading ? "Helvetica-Bold" : "Helvetica");
  assert.equal(italic.fontName, heading ? "Helvetica-BoldOblique" : "Helvetica-Oblique");
  assert.equal(reset.fontName, start.fontName);
  assert.equal(breaks.at(-1)!.fontSize, 11);
  assert.equal(breaks.at(-1)!.fontName, "Helvetica-Bold");
  assert.equal(pdf.pageCount, bottom ? 2 : 1);
  assert.equal(start.baselineY, bottom ? 80 : 720);
  assert.equal(breaks[0]!.baselineY, bottom ? (heading ? 672 : 705) : (heading ? 648 : 690));
  assert.equal(breaks[1]!.baselineY, breaks[0]!.baselineY - (heading ? 28 : 20));
  assert.deepEqual(mode === "command" ? await fs.readFile("/doc.docx") : files.get("/doc.docx"), input);
  assert.deepEqual((await fs.readdir("/")).map(e => e.name).sort(), mode === "command" ? ["doc.docx", "doc.pdf"] : ["doc.docx"]);
});
