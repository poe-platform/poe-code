import assert from "node:assert/strict";
import { it } from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { PdfDocument } from "@poe-code/pdf-ast";
import { readZipArchiveEntries, runSofficeCli, runSofficeFileCli } from "./index.js";

for (const format of ["txt", "md", "html", "docx", "pdf", "csv", "xlsx"]) for (const empty of [false, true]) it(`retains CSV ${format} conversion (${empty ? "empty" : "cells"})`, async () => {
  const fs = new MemoryFileSystem(), path = "/input.csv", output = `/input.${format}`;
  const bytes = new TextEncoder().encode(empty ? "" : '\ufeffHeading," A,""B"" & café "\r\n42,"line\nnext",tail\r');
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
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name).sort(), [...new Set(["input.csv", `input.${format}`])].sort());
});

for (const text of ['""', ',', '\r\n', 'a"b,c', '"a"tail,b', '"unterminated', 'a,"b""', '"' + '""'.repeat(20000) + '",tail', '"' + 'é'.repeat(8191) + '""\r\nend",tail', 'a,'.repeat(3000)]) it(`preserves CSV boundary and error semantics (${text.length} bytes, ${text.slice(0, 10)})`, async () => {
  const fs = new MemoryFileSystem(), bytes = new TextEncoder().encode(text);
  await fs.writeFile("/input.csv", bytes);
  const files = new Map([["/input.csv", bytes]]), args = ["--convert-to", "txt", "/input.csv"], expected = await runSofficeCli(args, files);
  const filesystem = new Proxy(fs, { get(target, key) {
    if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole-file I/O forbidden"); };
    const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
  } });
  let stdout = "", stderr = "";
  const result = await runSofficeFileCli(args, { filesystem,
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
  assert.deepEqual({ ...result, stdout, stderr }, expected);
  if (!result.exitCode) assert.deepEqual(await fs.readFile("/input.txt"), files.get("/input.txt"));
  else assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["input.csv"]);
});
