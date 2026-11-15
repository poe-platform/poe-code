import assert from "node:assert/strict";
import { it } from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { PdfDocument, encodePng } from "@poe-code/pdf-ast";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createSofficeCommand, createStoredZipArchive, runSofficeCli, runSofficeCliSync } from "./index.js";

const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
for (const [blank, count] of [
  ["<w:p/>", 1], ["<w:p></w:p>", 1], ["<w:p><w:r/></w:p>", 1],
  ["<w:p><w:r><w:t></w:t></w:r></w:p>", 1],
  ['<w:p><w:r><w:t xml:space="preserve"> </w:t></w:r></w:p>', 1],
  ["<w:p/><w:p/>", 2]
] as const)
for (const placement of ["middle", "leading", "overflow", "trailing"] as const)
it(`preserves empty DOCX paragraphs (${blank}, ${placement})`, async () => {
  const body = placement === "middle" ? paragraph("FIRST") + blank + paragraph("SECOND")
    : placement === "leading" ? blank + paragraph("SECOND")
    : placement === "overflow" ? paragraph("Filler").repeat(31) + paragraph("FIRST") + blank + paragraph("SECOND")
    : paragraph("Filler").repeat(32) + paragraph("FIRST") + blank;
  const input = createStoredZipArchive({"word/document.xml": new TextEncoder().encode(`<w:document xmlns:w="w"><w:body>${body}</w:body></w:document>`)});
  let reference: PdfDocument | undefined;
  for (const mode of ["sync", "async", "command"] as const) {
    const files = new Map([["/doc.docx", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/doc.docx", input);
    const args = ["--convert-to", "pdf", "/doc.docx"];
    const result = mode === "sync" ? runSofficeCliSync(args, files) : mode === "async" ? await runSofficeCli(args, files)
      : await createSofficeCommand().execute({command: "soffice", cwd: "/", env: {}, fs, ...createCommandArguments(args), signal: new AbortController().signal, stdin: toByteSource(""), stdout: {async write() {}}, stderr: {async write() {}}});
    assert.equal(result.exitCode, 0, mode);
    const pdf = PdfDocument.load(mode === "command" ? await fs.readFile("/doc.pdf") : files.get("/doc.pdf")!);
    assert.equal(pdf.pageCount, placement === "overflow" || placement === "trailing" ? 2 : 1, mode);
    const page = pdf.getPage(pdf.pageCount - 1);
    if (placement === "trailing") assert.equal(page.evaluateDisplayList().glyphs.length, 0, mode);
    else {
      const second = page.evaluateDisplayList().glyphs.filter(glyph => glyph.unicode === "S").at(-1);
      assert.ok(second, mode);
      assert.equal(second.baselineY, placement === "middle" ? 700 - count * 20 : placement === "leading" ? 720 - count * 20 : 720 - (count - 1) * 20, mode);
    }
    if (reference) for (let index = 0; index < pdf.pageCount; index++)
      assert.deepEqual(pdf.getPage(index).evaluateDisplayList(), reference.getPage(index).evaluateDisplayList(), mode);
    else reference = pdf;
    assert.deepEqual(mode === "command" ? await fs.readFile("/doc.docx") : files.get("/doc.docx"), input);
    assert.deepEqual((await fs.readdir("/")).map(entry => entry.name).sort(), mode === "command" ? ["doc.docx", "doc.pdf"] : ["doc.docx"]);
  }
});

const drawing = '<w:r><w:drawing><wp:extent cx="914400" cy="914400"/><a:blip r:embed="image"/></w:drawing></w:r>';
for (const [middle, pages, y] of [
  ["", 1, 700], ["<w:p><w:r><w:br/></w:r></w:p>", 1, 665],
  ["<w:p><w:r><w:br/><w:br/></w:r></w:p>", 1, 650],
  [`<w:p>${drawing}</w:p>`, 1, 616],
  [`<w:p><w:r><w:t>Caption</w:t></w:r>${drawing}</w:p>`, 1, 596],
  ['<w:p><w:r><w:br w:type="page"/></w:r></w:p>', 2, 720],
  ['<w:p><w:pPr><w:pageBreakBefore/></w:pPr></w:p>', 2, 700]
] as const)
for (const mode of ["sync", "async", "command"] as const)
it(`keeps DOCX content paragraph spacing (${middle}, ${mode})`, async () => {
  const encode = (text: string) => new TextEncoder().encode(text);
  const input = createStoredZipArchive({
    "word/document.xml": encode(`<w:document xmlns:w="w" xmlns:wp="wp" xmlns:a="a" xmlns:r="r"><w:body>${paragraph("FIRST")}${middle}${paragraph("SECOND")}</w:body></w:document>`),
    "word/_rels/document.xml.rels": encode('<Relationships><Relationship Id="image" Target="media/image.png"/></Relationships>'),
    "word/media/image.png": encodePng({width: 1, height: 1, data: Uint8Array.of(255, 0, 0, 255)})
  });
  const files = new Map([["/doc.docx", input]]), fs = new MemoryFileSystem();
  await fs.writeFile("/doc.docx", input);
  const args = ["--convert-to", "pdf", "/doc.docx"];
  const result = mode === "sync" ? runSofficeCliSync(args, files) : mode === "async" ? await runSofficeCli(args, files)
    : await createSofficeCommand().execute({command: "soffice", cwd: "/", env: {}, fs, ...createCommandArguments(args), signal: new AbortController().signal, stdin: toByteSource(""), stdout: {async write() {}}, stderr: {async write() {}}});
  assert.equal(result.exitCode, 0);
  const pdf = PdfDocument.load(mode === "command" ? await fs.readFile("/doc.pdf") : files.get("/doc.pdf")!);
  assert.equal(pdf.pageCount, pages);
  assert.equal(pdf.getPage(pages - 1).evaluateDisplayList().glyphs.filter(glyph => glyph.unicode === "S").at(-1)?.baselineY, y);
});
