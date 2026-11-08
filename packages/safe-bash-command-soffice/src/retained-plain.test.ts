import assert from "node:assert/strict";
import { it } from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runSofficeCli, runSofficeFileCli, readZipArchiveEntries } from "./index.js";

for (const extension of ["txt", "md"]) for (const format of ["html", "docx", "txt"])
for (const source of ["\ufeff# Heading  \r\n\n  paragraph & <x>  \r\n#   \nlast\r", "# " + " & 😀 ".repeat(9000) + "\n" + "  paragraph\n".repeat(4000), " \t\n\r\n", "first\n\ufeffsecond\n# \ufeff heading\n", Uint8Array.of(255, 13, 10, 35, 32, 240, 159, 10, 239, 187, 191, 97)])
it(`retains ${extension} to ${format} with the original text and heading rules`, async () => {
  const fs = new MemoryFileSystem(), path = "/input." + extension, bytes = typeof source === "string" ? new TextEncoder().encode(source) : source;
  await fs.writeFile(path, bytes); await fs.mkdir("/out");
  const args = ["--convert-to", format, "--outdir", "/out", path], files = new Map([[path, bytes]]);
  const expected = await runSofficeCli(args, files);
  const filesystem = new Proxy(fs, { get(target, key) {
    if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole-file I/O forbidden"); };
    const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
  } });
  let stdout = "", stderr = "";
  const result = await runSofficeFileCli(args, { filesystem, stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
  assert.deepEqual({ ...result, stdout, stderr }, expected);
  const actual = await fs.readFile("/out/input." + format), wanted = files.get("/out/input." + format)!;
  assert.deepEqual(format === "docx" ? readZipArchiveEntries(actual) : actual, format === "docx" ? readZipArchiveEntries(wanted) : wanted);
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name).sort(), ["input." + extension, "out"]);
});
