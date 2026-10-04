import assert from "node:assert/strict";
import { it } from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { PdfDocument } from "@poe-code/pdf-ast";
import { runSofficeCli, runSofficeFileCli } from "./index.js";

for (const [extension, source] of [
  ["txt", "# Heading\nText with <xml> & café.\n  spaces  and\ttabs  \n"],
  ["rtf", "{\\rtf1 Heading\\par Text with <xml> & caf\\'e9.}"],
  ["md", "# Title\n" + "A paragraph with enough words to wrap across lines. ".repeat(300)],
  ["txt", ""], ["txt", "#   \n"], ["txt", "x".repeat(90000)]
] as const) it(`retains ${extension} PDF layout and text through the file SDK`, async () => {
  const fs = new MemoryFileSystem(), path = "/input." + extension, bytes = new TextEncoder().encode(source);
  await fs.writeFile(path, bytes);
  const args = ["--convert-to", "pdf", path], files = new Map([[path, bytes]]);
  const expected = await runSofficeCli(args, files);
  const filesystem = new Proxy(fs, { get(target, key) {
    if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole-file I/O forbidden"); };
    const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
  } });
  let stdout = "", stderr = "";
  const result = await runSofficeFileCli(args, { filesystem, stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
  assert.deepEqual({ ...result, stdout, stderr }, expected);
  const actual = PdfDocument.load(await fs.readFile("/input.pdf")), wanted = PdfDocument.load(files.get("/input.pdf")!);
  assert.equal(actual.pageCount, wanted.pageCount);
  assert.deepEqual(actual.getMetadata(), wanted.getMetadata());
  assert.equal(actual.extractText(), wanted.extractText());
  if (source.length < 1000) assert.deepEqual(actual.getPage(0).renderToPng(), wanted.getPage(0).renderToPng());
});

for (const filter of ["pdf:writer_pdf_Export:{bad}", 'pdf:writer_pdf_Export:{"PageRange":{"value":"2-3"},"SelectPdfVersion":{"value":15}}', 'pdf:writer_pdf_Export:{"PageRange":"1.5-3","SelectPdfVersion":20}', 'pdf:writer_pdf_Export:{"PageRange":"999","SelectPdfVersion":20}'])
it(`preserves retained PDF filter semantics: ${filter}`, async () => {
  const fs = new MemoryFileSystem(), bytes = new TextEncoder().encode("# Title\n" + "Paragraph words. ".repeat(1200));
  await fs.writeFile("/input.md", bytes);
  const args = ["--convert-to", filter, "/input.md"], files = new Map([["/input.md", bytes]]);
  const expected = await runSofficeCli(args, files);
  const filesystem = new Proxy(fs, { get(target, key) {
    if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole-file I/O forbidden"); };
    const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
  } });
  const result = await runSofficeFileCli(args, { filesystem, stdout: { async write() {} }, stderr: { async write() {} } });
  assert.equal(result.exitCode, expected.exitCode);
  const actual = PdfDocument.load(await fs.readFile("/input.pdf")), wanted = PdfDocument.load(files.get("/input.pdf")!);
  assert.equal(actual.pageCount, wanted.pageCount); assert.deepEqual(actual.getMetadata(), wanted.getMetadata());
  assert.equal(actual.extractText(), wanted.extractText()); assert.equal(actual.cos.version, wanted.cos.version);
});
