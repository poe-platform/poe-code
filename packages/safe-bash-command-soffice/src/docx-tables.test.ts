import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { it } from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { encodeJpegImage, decodePngImage } from "@poe-code/image-ast";
import { PdfDocument, encodePng } from "@poe-code/pdf-ast";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createSofficeCommand, createStoredZipArchive, runSofficeCli, runSofficeCliSync } from "./index.js";

for (const fixture of ["grid", "empty-cell", "overflow", "plain"]) {
  it(`preserves DOCX table geometry in every route (${fixture})`, async () => {
    const input = await readFile(new URL(`./fixtures/tables/${fixture}.docx`, import.meta.url));
    const rows = fixture === "empty-cell" ? [["Left", "Middle", "Right"], ["A", "", "C"]]
      : fixture === "overflow" ? [["Name", "Count"], ...Array.from({ length: 40 }, (_, i) => [`Row ${i + 1}`, `Value ${i + 1}`])]
      : [["Name", "Count"], ["Alpha", "Seven"]];
    let reference: unknown;
    for (const mode of ["sync", "async", "command"]) {
      const files = new Map([["/doc.docx", new Uint8Array(input)]]), fs = new MemoryFileSystem();
      await fs.mkdir("/scratch");
      await fs.writeFile("/doc.docx", input);
      const args = ["--convert-to", "pdf", "/doc.docx"];
      const result = mode === "sync" ? runSofficeCliSync(args, files) : mode === "async" ? await runSofficeCli(args, files)
        : await createSofficeCommand().execute({ command: "soffice", cwd: "/", env: { TMPDIR: "/scratch" }, fs, ...createCommandArguments(args), signal: new AbortController().signal, stdin: toByteSource(""), stdout: { async write() {} }, stderr: { async write() {} } });
      assert.equal(result.exitCode, 0);
      const pdf = PdfDocument.load(mode === "command" ? await fs.readFile("/doc.pdf") : files.get("/doc.pdf")!);
      assert.equal(pdf.pageCount, fixture === "overflow" ? 2 : 1);
      const pages = Array.from({ length: pdf.pageCount }, (_, i) => pdf.getPage(i).evaluateDisplayList());
      const geometry = pages.map(page => ({ glyphs: page.glyphs.map(g => [g.unicode, g.matrix[4], g.baselineY, g.fontSize, g.fontName]), paths: page.paths }));
      if (reference) assert.deepEqual(geometry, reference);
      reference = geometry;
      const glyphs = pages.flatMap(page => page.glyphs);
      const text = glyphs.map(g => g.unicode).join("");
      assert.equal(text, fixture === "grid" || fixture === "plain" ? `Before table${rows.flat().join("")}After table` : rows.flat().join(""));
      assert.equal(pages.flatMap(page => page.paths).length, fixture === "plain" ? 0 : rows.length * rows[0]!.length);
      let offset = fixture === "grid" ? "Before table".length : 0;
      let y = fixture === "grid" ? 700 : 720;
      if (fixture !== "plain") for (const row of rows) {
        if (y - 28 < 54) y = 720;
        for (const [column, cell] of row.entries()) {
          if (cell) {
            assert.equal(glyphs[offset]!.matrix[4], 60 + column * 504 / row.length);
            assert.equal(glyphs[offset]!.baselineY, y - 16);
            assert.equal(glyphs[offset]!.fontSize, 10);
          }
          offset += cell.length;
        }
        y -= 22;
      }
      if (fixture === "grid") assert.equal(glyphs[offset]!.baselineY, 642);
      if (fixture === "plain") {
        let start = 0;
        for (const [i, paragraph] of ["Before table", ...rows.flat(), "After table"].entries()) {
          assert.equal(glyphs[start]!.matrix[4], 54);
          assert.equal(glyphs[start]!.baselineY, 720 - i * 20);
          start += paragraph.length;
        }
      }
      assert.deepEqual(new Uint8Array(mode === "command" ? await fs.readFile("/doc.docx") : files.get("/doc.docx")!), new Uint8Array(input));
      assert.deepEqual(await fs.readdir("/scratch"), []);
    }
  });
}

for (const picture of ["png", "jpeg", "missing", "corrupt"])
for (const mode of ["sync", "async", "command"])
it(`preserves table pictures and rejects invalid input atomically (${picture}, ${mode})`, async () => {
  const encode = (text: string) => new TextEncoder().encode(text);
  const drawing = '<w:r><w:drawing><wp:extent cx="1828800" cy="914400"/><a:blip r:embed="pic"/></w:drawing></w:r>';
  const paragraph = `<w:p><w:r><w:t>Before</w:t></w:r>${drawing}<w:r><w:t>After</w:t></w:r></w:p>`;
  const entries: Record<string, Uint8Array> = {
    "word/document.xml": encode(`<w:document xmlns:w="w" xmlns:wp="wp" xmlns:a="a" xmlns:r="r"><w:body><w:tbl><w:tr><w:tc>${paragraph}</w:tc><w:tc><w:p><w:r><w:t>Next cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>`),
    "word/_rels/document.xml.rels": encode('<Relationships><Relationship Id="pic" Target="media/image"/></Relationships>')
  };
  const data = Uint8Array.of(255, 0, 0, 255);
  if (picture !== "missing") entries["word/media/image"] = picture === "corrupt" ? Uint8Array.of(1, 2, 3) : picture === "png"
    ? encodePng({width: 1, height: 1, data})
    : encodeJpegImage({format: "jpeg", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: false, width: 1, height: 1, data});
  const input = createStoredZipArchive(entries), previous = encode("existing PDF");
  const files = new Map([["/doc.docx", input], ["/doc.pdf", previous]]), fs = new MemoryFileSystem();
  await fs.mkdir("/scratch");
  await fs.writeFile("/doc.docx", input); await fs.writeFile("/doc.pdf", previous);
  const args = ["--convert-to", "pdf", "/doc.docx"];
  const result = mode === "sync" ? runSofficeCliSync(args, files) : mode === "async" ? await runSofficeCli(args, files)
    : await createSofficeCommand().execute({command: "soffice", cwd: "/", env: {TMPDIR: "/scratch"}, fs, ...createCommandArguments(args), signal: new AbortController().signal,
      stdin: toByteSource(""), stdout: {async write() {}}, stderr: {async write() {}}});
  const valid = picture === "png" || picture === "jpeg";
  assert.equal(result.exitCode, valid ? 0 : 1);
  const output = mode === "command" ? await fs.readFile("/doc.pdf") : files.get("/doc.pdf")!;
  if (valid) {
    const pdf = PdfDocument.load(output);
    assert.equal(pdf.pageCount, 1);
    const page = pdf.getPage(0), display = page.evaluateDisplayList();
    assert.equal(display.glyphs.map(g => g.unicode).join(""), "BeforeAfterNext cell");
    assert.equal(display.images.length, 1);
    assert.equal(display.images[0]!.matrix[0], 144);
    assert.equal(Math.abs(display.images[0]!.matrix[3]), 72);
    assert.equal(display.glyphs[0]!.baselineY, 720);
    assert.equal(display.glyphs[6]!.baselineY, 616);
    assert.equal(display.glyphs[11]!.baselineY, 596);
    const raster = decodePngImage(page.renderToPng({scale: 1}));
    let red = 0;
    for (let i = 0; i < raster.data.length; i += 4)
      if (raster.data[i]! > 240 && raster.data[i + 1]! < 10 && raster.data[i + 2]! < 10) red++;
    // Rasterizers may include the final pixel along each image edge.
    assert.ok(red >= 144 * 72 && red <= 145 * 73);
  } else assert.deepEqual(output, previous);
  assert.deepEqual(mode === "command" ? await fs.readFile("/doc.docx") : files.get("/doc.docx"), input);
  assert.deepEqual(await fs.readdir("/scratch"), []);
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name).sort(), ["doc.docx", "doc.pdf", "scratch"]);
});
