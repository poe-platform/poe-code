import assert from "node:assert/strict";
import { it } from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createStoredZipArchive, runSofficeCli, runSofficeFileCli } from "./index.js";
const encode = (value: string) => new TextEncoder().encode(value);
for (const entries of [
  { "xl/worksheets/sheet1.xml": `<worksheet><row><c r='C1' t='s'><v>0</v></c><c><v extra="x">ignored</v><v>kept</v></c></row></worksheet>`, "xl/sharedStrings.xml": "<sst><si><t>shared</t></si></sst>" },
  {},
  { "xl/worksheets/sheet2.xml": '<worksheet><row><c><v>fallback</v></c></row></worksheet>' },
  { "xl/worksheets/sheet2.xml": '<worksheet><row><c><v>ignored</v></c></row></worksheet>', "xl/worksheets/sheet1.xml": '<worksheet><row><c r="B1" t="s"><v>0</v></c><c r="D1" t="inlineStr"><is><t> &amp; &#xFEFF; </t><t>ignored</t></is></c><c r="F1"/><c><v> 42 </v></c></row><row/><row><c t="s"><v>1</v></c><c t="s"><v>99</v></c></row></worksheet>', "xl/sharedStrings.xml": '<sst><si><r><t> A&amp; </t></r><r><t>&#65;</t></r></si><si><t>&amp;</t><t>lt;</t></si></sst>' },
  { "xl/worksheets/sheet1.xml": '<worksheet><row><c t="s"><v> +0000suffix</v></c><c t="s"><v>-1</v></c><c t="inlineStr"><is><t>x<b/>y</t></is></c></row></worksheet>', "xl/sharedStrings.xml": '<sst><si><t>preserved</t></si></sst>' }
].entries()) it(`extracts XLSX through caller backing (${entries[0]})`, async () => {
  const fs = new MemoryFileSystem();
  const bytes = createStoredZipArchive(Object.fromEntries(Object.entries(entries[1]).map(([key, value]) => [key, encode(value)])));
  await fs.writeFile("/input.xlsx", bytes);
  const expected = await runSofficeCli(["--cat", "/input.xlsx"], new Map([["/input.xlsx", bytes]]));
  const filesystem = new Proxy(fs, { get(target, key) {
    if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole-file I/O forbidden"); };
    const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
  } });
  let stdout = "", stderr = "";
  const decoder = new TextDecoder();
  const actual = await runSofficeFileCli(["--cat", "/input.xlsx"], { filesystem,
    stdout: { async write(bytes) { stdout += decoder.decode(bytes, { stream: true }); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
  stdout += decoder.decode();
  assert.deepEqual({ ...actual, stdout, stderr }, expected);
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["input.xlsx"]);
});

it("spills XLSX shared strings and output while respecting stdout backpressure", async () => {
  const fs = new MemoryFileSystem(), payload = "a".repeat(1100000) + "🙂 & ";
  const bytes = createStoredZipArchive({
    "xl/worksheets/sheet1.xml": encode('<worksheet><row><c t="s"><v>1</v></c></row><row><c r="C2" t="s"><v>0</v></c></row></worksheet>'),
    "xl/sharedStrings.xml": encode('<sst><si><t>' + payload.replaceAll("&", "&amp;") + '</t></si><si><t>Heading</t></si></sst>')
  });
  await fs.writeFile("/input.xlsx", bytes);
  let length = 0, largest = 0, pending = false, hash = 2166136261;
  const filesystem = new Proxy(fs, { get(target, key) {
    if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole-file I/O forbidden"); };
    const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
  } });
  const result = await runSofficeFileCli(["--cat", "/input.xlsx"], { filesystem,
    stdout: { async write(bytes) {
      assert.equal(pending, false); pending = true; await Promise.resolve();
      largest = Math.max(largest, bytes.length); length += bytes.length;
      for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
      pending = false;
    } }, stderr: { async write(bytes) { assert.fail(new TextDecoder().decode(bytes)); } } });
  const expected = encode("Heading\n\t\t" + payload + "\n"); let wanted = 2166136261;
  for (const byte of expected) wanted = Math.imul(wanted ^ byte, 16777619) >>> 0;
  assert.equal(result.exitCode, 0); assert.equal(hash, wanted); assert.equal(length, expected.length);
  assert.ok(largest <= 16384); assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["input.xlsx"]);
});

for (const mode of ["cancel", "sink", "malformed"]) it(`cleans XLSX caller storage on ${mode}`, async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.xlsx", mode === "malformed" ? Uint8Array.of(1, 2) : createStoredZipArchive({
    "xl/worksheets/sheet1.xml": encode('<worksheet><row><c><v>' + 'x'.repeat(1100000) + '</v></c></row></worksheet>')
  }));
  const controller = new AbortController(), reason = new Error(mode); let writes = 0;
  const operation = runSofficeFileCli(["--cat", "/input.xlsx"], { filesystem: fs, signal: controller.signal,
    stdout: { async write() { writes++; if (mode === "cancel") controller.abort(reason); else throw reason; } },
    stderr: { async write() {} } });
  if (mode === "malformed") { assert.equal((await operation).exitCode, 1); assert.equal(writes, 0); }
  else await assert.rejects(operation, error => error === reason);
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["input.xlsx"]);
});

for (const format of ["txt", "md"]) it(`converts XLSX to ${format} through caller backing`, async () => {
  const fs = new MemoryFileSystem();
  const bytes = createStoredZipArchive({ "xl/worksheets/sheet1.xml": encode('<worksheet><row><c r="B1" t="inlineStr"><is><t> A &amp; B </t></is></c></row><row><c><v>42</v></c></row></worksheet>') });
  await fs.writeFile("/input.xlsx", bytes);
  const files = new Map([["/input.xlsx", bytes]]), args = ["--convert-to", format, "/input.xlsx"];
  const expected = await runSofficeCli(args, files);
  const filesystem = new Proxy(fs, { get(target, key) {
    if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole-file I/O forbidden"); };
    const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
  } });
  let stdout = "", stderr = "";
  const actual = await runSofficeFileCli(args, { filesystem,
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
  assert.deepEqual({ ...actual, stdout, stderr }, expected);
  assert.deepEqual(await fs.readFile(`/input.${format}`), files.get(`/input.${format}`));
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name).sort(), [`input.${format}`, "input.xlsx"].sort());
});
