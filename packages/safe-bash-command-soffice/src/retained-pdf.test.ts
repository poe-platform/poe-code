import assert from "node:assert/strict";
import { it } from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { PdfDocument, type PdfContentNode } from "@poe-code/pdf-ast";
import { createStoredZipArchive, runSofficeCli, runSofficeFileCli } from "./index.js";

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

for (const extension of ["odt", "ods", "odp"]) it(`retains ${extension} PDF headings and tables without whole-file I/O`, async () => {
  const fs = new MemoryFileSystem(), path = `/input.${extension}`;
  const xml = '<office><text:h>Title</text:h><text:p>Body &amp; café</text:p><table:table><table:table-row><table:table-cell>Name</table:table-cell><table:table-cell>Value</table:table-cell></table:table-row><table:table-row><table:table-cell>A</table:table-cell><table:table-cell>12</table:table-cell><table:table-cell>Extra</table:table-cell></table:table-row></table:table><text:p>End</text:p></office>';
  const bytes = createStoredZipArchive({ "content.xml": new TextEncoder().encode(xml) });
  await fs.writeFile(path, bytes);
  const files = new Map([[path, bytes]]), args = ["--convert-to", "pdf", path];
  const expected = await runSofficeCli(args, files);
  const filesystem = new Proxy(fs, { get(target, key) {
    if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole-file I/O forbidden"); };
    const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
  } });
  let stdout = "", stderr = "";
  const result = await runSofficeFileCli(args, { filesystem, stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
  assert.deepEqual({ ...result, stdout, stderr }, expected);
  const actual = PdfDocument.load(await fs.readFile("/input.pdf")), wanted = PdfDocument.load(files.get("/input.pdf")!);
  assert.equal(actual.pageCount, wanted.pageCount); assert.deepEqual(actual.getMetadata(), wanted.getMetadata());
  assert.equal(actual.extractText(), wanted.extractText());
  assert.deepEqual(actual.getPage(0).renderToPng(), wanted.getPage(0).renderToPng());
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name).sort(), [`input.${extension}`, "input.pdf"].sort());
});

for (const filter of ["pdf", 'pdf:writer_pdf_Export:{"PageRange":"2-3","SelectPdfVersion":15}']) it(`spills OpenDocument PDF tables and preserves page filters: ${filter}`, async () => {
  const fs = new MemoryFileSystem();
  const xml = '<office><text:h>Pages</text:h><table:table>' + '<table:table-row><table:table-cell>A</table:table-cell><table:table-cell>B</table:table-cell></table:table-row>'.repeat(100) + (filter === "pdf" ? '<table:table-row><table:table-cell>' + 'x'.repeat(1100000) + '</table:table-cell></table:table-row>' : '') + '</table:table></office>';
  const bytes = createStoredZipArchive({ "content.xml": new TextEncoder().encode(xml) });
  await fs.writeFile("/input.odt", bytes);
  const files = new Map([["/input.odt", bytes]]), args = ["--convert-to", filter, "/input.odt"];
  const expected = await runSofficeCli(args, files);
  let largest = 0;
  const filesystem = new Proxy(fs, { get(target, key) {
    if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole-file I/O forbidden"); };
    if (key === "createStagedFile") return async (...args: Parameters<typeof fs.createStagedFile>) => {
      const stage = await fs.createStagedFile(...args);
      return { ...stage, writer: { async write(bytes: Uint8Array, options?: { signal?: AbortSignal }) {
        largest = Math.max(largest, bytes.length); await stage.writer!.write(bytes, options);
      }, finish: stage.writer!.finish.bind(stage.writer) } };
    };
    const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
  } });
  const result = await runSofficeFileCli(args, { filesystem, stdout: { async write() {} }, stderr: { async write() {} } });
  assert.equal(result.exitCode, expected.exitCode);
  const actual = PdfDocument.load(await fs.readFile("/input.pdf")), wanted = PdfDocument.load(files.get("/input.pdf")!);
  assert.equal(actual.pageCount, wanted.pageCount); assert.equal(actual.cos.version, wanted.cos.version);
  assert.deepEqual(actual.getMetadata(), wanted.getMetadata());
  const contentText = (document: PdfDocument) => {
    const fragments: string[] = [];
    const inspect = (nodes: readonly PdfContentNode[]) => {
      for (const node of nodes) {
        if (node.kind === "graphics-group") inspect(node.ops);
        else if (node.kind === "text-object") for (const command of node.commands)
          if (command.kind === "show-text" && command.token.kind === "string") fragments.push(new TextDecoder().decode(command.token.bytes));
      }
    };
    for (let page = 0; page < document.pageCount; page++) inspect(document.getPage(page).getContentAst());
    return fragments.join("");
  };
  assert.equal(contentText(actual), contentText(wanted));
  assert.ok(largest > 0 && largest <= 16384);
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name).sort(), ["input.odt", "input.pdf"]);
});
