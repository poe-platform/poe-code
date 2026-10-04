import assert from "node:assert/strict";
import { it } from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runSofficeCli, runSofficeFileCli, readZipArchiveEntries } from "./index.js";

for (const text of [String.raw`{\rtf1 Heading\par Text with <xml> & \'e9.}`, "{\\rtf1 " + "a & <b> ".repeat(140000) + "\\par end}"])
it("exports retained RTF paragraphs as independently readable DOCX parts", async () => {
  const fs = new MemoryFileSystem(), bytes = new TextEncoder().encode(text);
  await fs.writeFile("/input.rtf", bytes);
  const files = new Map([["/input.rtf", bytes]]), args = ["--convert-to", "docx", "/input.rtf"];
  const expected = await runSofficeCli(args, files);
  const filesystem = new Proxy(fs, { get(target, key) {
    if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole-file I/O forbidden"); };
    const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
  } });
  let stdout = "", stderr = "";
  const result = await runSofficeFileCli(args, { filesystem, stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
  assert.deepEqual({ ...result, stdout, stderr }, expected);
  assert.deepEqual(readZipArchiveEntries(await fs.readFile("/input.docx")), readZipArchiveEntries(files.get("/input.docx")!));
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name).sort(), ["input.docx", "input.rtf"]);
});
