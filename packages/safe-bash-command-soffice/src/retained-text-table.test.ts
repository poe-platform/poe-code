import assert from "node:assert/strict";
import { it } from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { readZipArchiveEntries, runSofficeCli, runSofficeFileCli } from "./index.js";

for (const extension of ["txt", "md"]) for (const format of ["csv", "xlsx"]) for (const text of [
  "", 'a,b\r\n"c,d",e', 'a,b\tsecond\r\n"line\nnext"\t42', '"bad',
  "prose\n| A | B |\n| :--- | --: |\n| a\\|b | café |\n| short |\n| a | b | extra |\nend",
  "| A | B |\n| - | - |\n| x | y |\n\nC|D\n-|:-:\ne|f\n",
  "| A | B |\n| -- | invalid |\nx|y",
  "A|B\n-|--\n|\nend",
  "  | A | B |  \r\n | :-: | -- | \r\n| a\\| | trailing\\ |\r\n",
  "A|B\n-|--\nx|y\nNext|Table\n-|--\na|b",
  "A|B\n-|--\nx|y\nprose\nNext|Table\n-|--\na|b",
  "A|B\n-|--\nx|y\n\ufeffhidden|z\n",
  "|" + "é".repeat(8191) + "\\|end|\n|-|\n| body |\n",
  "|" + " - |".repeat(1200) + "\n|" + " - |".repeat(1200) + "\n|tail|\n",
  '"' + 'a'.repeat(16383) + '\t' + 'b'.repeat(16384) + '",tail'
]) it(`retains ${extension} to ${format} table semantics (${text.length}, ${text.slice(0, 12)})`, async () => {
  const fs = new MemoryFileSystem(), input = `/input.${extension}`, output = `/input.${format}`, bytes = new TextEncoder().encode(text);
  await fs.writeFile(input, bytes);
  const files = new Map([[input, bytes]]), args = ["--convert-to", format, input], expected = await runSofficeCli(args, files);
  const filesystem = new Proxy(fs, { get(target, key) {
    if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole-file I/O forbidden"); };
    const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
  } });
  let stdout = "", stderr = "";
  const result = await runSofficeFileCli(args, { filesystem,
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
  assert.deepEqual({ ...result, stdout, stderr }, expected);
  if (!result.exitCode) {
    const actual = await fs.readFile(output), wanted = files.get(output)!;
    if (format === "xlsx") assert.deepEqual(readZipArchiveEntries(actual), readZipArchiveEntries(wanted));
    else assert.deepEqual(actual, wanted);
  } else assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), [input.slice(1)]);
});
