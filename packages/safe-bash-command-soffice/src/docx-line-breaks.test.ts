import assert from "node:assert/strict";
import { it } from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { PdfDocument } from "@poe-code/pdf-ast";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createSofficeCommand, createStoredZipArchive, runSofficeCli, runSofficeCliSync } from "./index.js";

for (const mode of ["sync", "async", "command"] as const)
for (const [separator, spacing] of [["<w:br/>", 15], ['<w:br w:type="textWrapping"/>', 15], ["<w:cr/>", 15], ["<w:br/><w:br/>", 30], ["<w:t> </w:t>", 0], ["</w:r></w:p><w:p><w:r>", 20]] as const)
for (const bottom of [false, true]) it(`preserves DOCX line positions (${mode}, ${separator}, bottom=${bottom})`, async () => {
  const prefix = bottom ? '<w:p><w:r><w:t>Filler</w:t></w:r></w:p>'.repeat(32) : "";
  const input = createStoredZipArchive({"word/document.xml": new TextEncoder().encode(`<w:document xmlns:w="w"><w:body>${prefix}<w:p><w:r><w:t>FIRST LINE</w:t>${separator}<w:t>SECOND LINE</w:t></w:r></w:p></w:body></w:document>`)});
  const files = new Map([["/doc.docx", input]]), fs = new MemoryFileSystem();
  await fs.writeFile("/doc.docx", input);
  const args = ["--convert-to", "pdf", "/doc.docx"];
  const result = mode === "sync" ? runSofficeCliSync(args, files) : mode === "async" ? await runSofficeCli(args, files) : await createSofficeCommand().execute({command: "soffice", cwd: "/", env: {}, fs, ...createCommandArguments(args), signal: new AbortController().signal, stdin: toByteSource(""), stdout: {async write() {}}, stderr: {async write() {}}});
  assert.equal(result.exitCode, 0);
  const pdf = PdfDocument.load(mode === "command" ? await fs.readFile("/doc.pdf") : files.get("/doc.pdf")!);
  const secondPage = bottom && spacing > 0;
  assert.equal(pdf.pageCount, secondPage ? 2 : 1);
  const first = pdf.getPage(0).evaluateDisplayList().glyphs.find(glyph => glyph.unicode === "F" && glyph.baselineY === (bottom ? 80 : 720));
  const second = pdf.getPage(secondPage ? 1 : 0).evaluateDisplayList().glyphs.filter(glyph => glyph.unicode === "S").at(-1);
  assert.ok(first); assert.ok(second);
  assert.equal(second.baselineY, secondPage ? 720 - (spacing === 30 ? 15 : 0) : first.baselineY - spacing);
  assert.equal(first.matrix[4], 54);
  if (spacing) assert.equal(second.matrix[4], 54);
  else assert.ok(second.matrix[4] > first.matrix[4]);
  assert.deepEqual(mode === "command" ? await fs.readFile("/doc.docx") : files.get("/doc.docx"), input);
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name).sort(), mode === "command" ? ["doc.docx", "doc.pdf"] : ["doc.docx"]);
});
