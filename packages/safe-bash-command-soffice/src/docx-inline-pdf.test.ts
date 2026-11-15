import assert from "node:assert/strict";
import { it } from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { PdfDocument, encodePng } from "@poe-code/pdf-ast";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createSofficeCommand, createStoredZipArchive, runSofficeCli, runSofficeCliSync } from "./index.js";

const runs = [
  ["", "  Plain ", "Helvetica"],
  ["<w:b/>", "Bold", "Helvetica-Bold"],
  ["<w:i/>", "Italic", "Helvetica-Oblique"],
  ["<w:b/><w:i/>", "Both café € ", "Helvetica-BoldOblique"],
  ...["false", "0", "off"].map(value => [`<w:b w:val="${value}"/><w:i w:val="${value}"/>`, "Reset ", "Helvetica"]),
  ...["true", "1", "on"].map(value => [`<w:b w:val="${value}"/><w:i w:val="${value}"/>`, "Enabled ", "Helvetica-BoldOblique"]),
  ["<w:i/>", "wrapped ".repeat(25), "Helvetica-Oblique"],
  ["", "end", "Helvetica"]
];
for (const plain of [false, true])
for (const overflow of [false, true])
it(`preserves DOCX inline PDF glyphs and layout (plain=${plain}, overflow=${overflow})`, async () => {
  const paragraph = runs.map(([properties, text]) => `<w:r><w:rPr>${plain ? "" : properties}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`).join("");
  const prefix = '<w:p><w:r><w:t>Filler</w:t></w:r></w:p>'.repeat(overflow ? 31 : 0);
  const input = createStoredZipArchive({ "word/document.xml": new TextEncoder().encode(`<w:document xmlns:w="w"><w:body>${prefix}<w:p/>` +
    `<w:p><w:r><w:br/></w:r>${paragraph}<w:r><w:br/><w:br/><w:t>Tail</w:t><w:cr/></w:r></w:p><w:p/><w:p><w:r><w:t>Last</w:t></w:r></w:p></w:body></w:document>`) });
  let reference: unknown;
  for (const mode of ["async", "command", "sync"] as const) {
    const files = new Map([["/doc.docx", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/doc.docx", input);
    const args = ["--convert-to", "pdf", "/doc.docx"];
    const result = mode === "sync" ? runSofficeCliSync(args, files) : mode === "async" ? await runSofficeCli(args, files)
      : await createSofficeCommand().execute({command: "soffice", cwd: "/", env: {}, fs, ...createCommandArguments(args), signal: new AbortController().signal,
        stdin: toByteSource(""), stdout: {async write() {}}, stderr: {async write() {}}});
    assert.equal(result.exitCode, 0, mode);
    const pdf = PdfDocument.load(mode === "command" ? await fs.readFile("/doc.pdf") : files.get("/doc.pdf")!);
    assert.equal(pdf.pageCount, overflow ? 2 : 1, mode);
    const pages = Array.from({length: pdf.pageCount}, (_, index) => pdf.getPage(index).evaluateDisplayList().glyphs);
    const glyphs = pages.flat().filter(glyph => glyph.unicode.trim());
    const expected = [
      ...Array.from("Filler".repeat(overflow ? 31 : 0), char => [char, "Helvetica"]),
      ...runs.flatMap(([, text, font]) => Array.from(text!).filter(char => char.trim()).map(char => [char, plain ? "Helvetica" : font])),
      ...Array.from("TailLast", char => [char, "Helvetica"])
    ];
    assert.deepEqual(glyphs.map(glyph => [glyph.unicode, glyph.fontName]), expected, mode);
    assert.ok(glyphs.every(glyph => glyph.fontSize === 11), mode);
    // Separate draw calls round PDF coordinates; compare far below a visible pixel.
    const positions = pages.map(page => page.map(glyph => ({
      text: glyph.unicode, font: glyph.fontName, size: glyph.fontSize,
      matrix: glyph.matrix.map(value => Number(value.toFixed(5)))
    })));
    if (reference) assert.deepEqual(positions, reference, mode);
    else reference = positions;
    assert.deepEqual(mode === "command" ? await fs.readFile("/doc.docx") : files.get("/doc.docx"), input);
  }
});

for (const boundary of ["image", "page"] as const)
for (const mode of ["sync", "async", "command"] as const)
it(`preserves DOCX inline fonts around ${boundary} boundaries (${mode})`, async () => {
  const encode = (text: string) => new TextEncoder().encode(text);
  const middle = boundary === "page" ? '<w:br w:type="page"/>' : '<w:drawing><wp:extent cx="914400" cy="914400"/><a:blip r:embed="image"/></w:drawing>';
  const input = createStoredZipArchive({
    "word/document.xml": encode(`<w:document xmlns:w="w" xmlns:wp="wp" xmlns:a="a" xmlns:r="r"><w:body><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Before</w:t></w:r><w:r>${middle}</w:r><w:r><w:rPr><w:i/></w:rPr><w:t>After</w:t></w:r></w:p></w:body></w:document>`),
    "word/_rels/document.xml.rels": encode('<Relationships><Relationship Id="image" Target="media/image.png"/></Relationships>'),
    "word/media/image.png": encodePng({width: 1, height: 1, data: Uint8Array.of(255, 0, 0, 255)})
  });
  const files = new Map([["/doc.docx", input]]), fs = new MemoryFileSystem();
  await fs.writeFile("/doc.docx", input);
  const args = ["--convert-to", "pdf", "/doc.docx"];
  const result = mode === "sync" ? runSofficeCliSync(args, files) : mode === "async" ? await runSofficeCli(args, files)
    : await createSofficeCommand().execute({command: "soffice", cwd: "/", env: {}, fs, ...createCommandArguments(args), signal: new AbortController().signal,
      stdin: toByteSource(""), stdout: {async write() {}}, stderr: {async write() {}}});
  assert.equal(result.exitCode, 0);
  const pdf = PdfDocument.load(mode === "command" ? await fs.readFile("/doc.pdf") : files.get("/doc.pdf")!);
  assert.equal(pdf.pageCount, boundary === "page" ? 2 : 1);
  const pages = Array.from({length: pdf.pageCount}, (_, index) => pdf.getPage(index).evaluateDisplayList());
  assert.deepEqual(pages.flatMap(page => page.glyphs).map(glyph => [glyph.unicode, glyph.fontName, glyph.fontSize, glyph.baselineY]), [
    ...Array.from("Before", char => [char, "Helvetica-Bold", 11, 720]),
    ...Array.from("After", char => [char, "Helvetica-Oblique", 11, boundary === "page" ? 720 : 616])
  ]);
  assert.equal(pages.flatMap(page => page.images).length, boundary === "image" ? 1 : 0);
});
