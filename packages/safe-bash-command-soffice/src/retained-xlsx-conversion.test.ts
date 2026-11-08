import assert from "node:assert/strict";
import { it } from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { PdfDocument } from "@poe-code/pdf-ast";
import { createStoredZipArchive, readZipArchiveEntries, runSofficeCli, runSofficeFileCli } from "./index.js";

for (const format of ["html", "docx", "pdf", "csv", "xlsx"]) for (const empty of [false, true]) it(`retains XLSX ${format} conversion (${empty ? "empty" : "cells"})`, async () => {
  const fs = new MemoryFileSystem(), path = "/input.xlsx", output = `/input.${format}`;
  const bytes = createStoredZipArchive(empty ? {} : {
    "xl/worksheets/sheet1.xml": new TextEncoder().encode('<worksheet><row><c t="s"><v>0</v></c><c r="C1" t="inlineStr"><is><t> A,&quot;B&quot; &amp; café </t></is></c></row><row><c><v>42</v></c></row></worksheet>'),
    "xl/sharedStrings.xml": new TextEncoder().encode('<sst><si><t>Heading</t></si></sst>')
  });
  await fs.writeFile(path, bytes);
  const files = new Map([[path, bytes]]), args = ["--convert-to", format, path], expected = await runSofficeCli(args, files);
  const filesystem = new Proxy(fs, { get(target, key) {
    if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole-file I/O forbidden"); };
    const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
  } });
  let stdout = "", stderr = "";
  const result = await runSofficeFileCli(args, { filesystem,
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
  assert.deepEqual({ ...result, stdout, stderr }, expected);
  const actual = await fs.readFile(output), wanted = files.get(output)!;
  if (format === "pdf") {
    const a = PdfDocument.load(actual), b = PdfDocument.load(wanted);
    assert.equal(a.pageCount, b.pageCount); assert.deepEqual(a.getMetadata(), b.getMetadata());
    assert.equal(a.extractText(), b.extractText()); assert.deepEqual(a.getPage(0).renderToPng(), b.getPage(0).renderToPng());
  } else if (format === "docx" || format === "xlsx") assert.deepEqual(readZipArchiveEntries(actual), readZipArchiveEntries(wanted));
  else assert.deepEqual(actual, wanted);
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name).sort(), [...new Set(["input.xlsx", `input.${format}`])].sort());
});

for (const input of ["/input.xlsx", "/input.csv"]) for (const filter of ['csv:Text - txt - csv (StarCalc):59,39', 'csv:Text - txt - csv (StarCalc):44,34,0,0,0,0,true']) it(`preserves retained CSV filter quoting: ${input} ${filter}`, async () => {
  const fs = new MemoryFileSystem();
  const bytes = input.endsWith(".csv") ? new TextEncoder().encode('"' + 'a'.repeat(4095) + '"";\'\nend",42') : createStoredZipArchive({ "xl/worksheets/sheet1.xml": new TextEncoder().encode('<worksheet><row><c t="inlineStr"><is><t>' + 'a'.repeat(4095) + '&quot;;&apos;\nend</t></is></c><c><v>42</v></c></row></worksheet>') });
  await fs.writeFile(input, bytes);
  const files = new Map([[input, bytes]]), args = ["--convert-to", filter, input], expected = await runSofficeCli(args, files);
  const filesystem = new Proxy(fs, { get(target, key) {
    if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole-file I/O forbidden"); };
    const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
  } });
  const result = await runSofficeFileCli(args, { filesystem, stdout: { async write() {} }, stderr: { async write() {} } });
  assert.equal(result.exitCode, expected.exitCode); assert.deepEqual(await fs.readFile("/input.csv"), files.get("/input.csv"));
});
