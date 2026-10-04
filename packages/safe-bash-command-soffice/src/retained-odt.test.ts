import assert from "node:assert/strict";
import { it } from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createStoredZipArchive, runSofficeCli, runSofficeFileCli } from "./index.js";

const encode = (text: string) => new TextEncoder().encode(text);
const fixtures = [
  "<office><text:p>\ufeff visible </text:p></office>",
  '<office><text:p>&#xfeff;visible</text:p></office>',
  '<office><text:h> Title </text:h><text:p> a <text:span>b</text:span> c </text:p><text:p> </text:p></office>',
  '<office><text:p>&#x26;#65; &amp;lt; &#32; &lt;&gt;&quot;&apos;</text:p><text:p>\r\n x\r y\n </text:p></office>',
  '<office><text:p>before</text:p><table:table><table:table-row><table:table-cell><text:p>A</text:p><text:p>B</text:p></table:table-cell><table:table-cell> </table:table-cell></table:table-row><table:table-row/><table:table-row><table:table-cell>C</table:table-cell></table:table-row></table:table><text:p>after</text:p></office>',
  '<office> fallback <x>raw &amp; text</x> </office>',
  '<office><text:p/><!-- skipped --><text:p> </text:p></office>',
  '<office><text:p> &#x000000000000000000000000000000000000000000041; &bogus; &#xZ; </text:p></office>'
];
for (const extension of ["odt", "ods", "odp"]) for (const [index, xml] of fixtures.entries()) {
  it(`extracts retained ${extension} text with byte-SDK parity (${index})`, async () => {
    const fs = new MemoryFileSystem(), path = `/input.${extension}`;
    const bytes = createStoredZipArchive({ "content.xml": encode(xml) });
    await fs.writeFile(path, bytes);
    const expected = await runSofficeCli(["--cat", path], new Map([[path, bytes]]));
    const filesystem = new Proxy(fs, { get(target, key) {
      if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file I/O forbidden"); };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    let stdout = "", stderr = "";
    const actual = await runSofficeFileCli(["--cat", path], { filesystem,
      stdout: { async write(bytes) { stdout += new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes); } } });
    assert.deepEqual({ ...actual, stdout, stderr }, expected);
    assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), [path.slice(1)]);
  });
}

it("spills long OpenDocument paragraphs and block metadata while respecting sink backpressure", async () => {
  const fs = new MemoryFileSystem(), text = "a".repeat(1100000) + " &amp; &#x" + "0".repeat(20000) + "41;";
  const xml = `<office><text:p>${text}</text:p>${"<text:p>x</text:p>".repeat(5000)}</office>`;
  const bytes = createStoredZipArchive({ "content.xml": encode(xml) });
  await fs.writeFile("/input.odt", bytes);
  const expected = await runSofficeCli(["--cat", "/input.odt"], new Map([["/input.odt", bytes]]));
  let stdout = "", busy = false, opened = 0, closed = 0;
  const filesystem = new Proxy(fs, { get(target, key) {
    if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file I/O forbidden"); };
    if (key === "open") return async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args); opened++;
      return new Proxy(handle, { get(target, key) {
        if (key === "close") return async () => { closed++; await handle.close(); };
        if (key === "read" || key === "write") return async (...args: Parameters<typeof handle.read>) => {
          assert.ok(args[0].length <= 16384);
          return handle[key](...args);
        };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      } });
    };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const result = await runSofficeFileCli(["--cat", "/input.odt"], { filesystem,
    stdout: { async write(bytes) {
      assert.equal(busy, false); busy = true;
      assert.ok(bytes.length <= 16384);
      await Promise.resolve(); stdout += new TextDecoder().decode(bytes); busy = false;
    } }, stderr: { async write(bytes) { assert.fail(new TextDecoder().decode(bytes)); } } });
  assert.equal(result.exitCode, 0); assert.equal(stdout, expected.stdout);
  assert.ok(opened > 0); assert.equal(closed, opened);
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["input.odt"]);
});

for (const mode of ["output-limit", "cancel", "sink", "malformed"] as const) it(`retires OpenDocument backing on ${mode}`, async () => {
  const fs = new MemoryFileSystem(), controller = new AbortController(), failure = new Error(mode);
  await fs.writeFile("/input.odt", mode === "malformed" ? Uint8Array.of(1, 2, 3) : createStoredZipArchive({ "content.xml": encode('<office><text:p>' + "a".repeat(1100000) + '</text:p></office>') }));
  let writes = 0, diagnostic = "";
  const operation = runSofficeFileCli(["--cat", "/input.odt"], { filesystem: fs,
    signal: controller.signal, limits: mode === "output-limit" ? { maxOutputBytes: 100 } : {},
    inputBudget: { check() { if (mode === "cancel") setTimeout(() => controller.abort(failure), 0); } },
    stdout: { async write() { writes++; if (mode === "sink") throw failure; } },
    stderr: { async write(bytes) { diagnostic += new TextDecoder().decode(bytes); } } });
  if (mode === "malformed") { assert.equal((await operation).exitCode, 1); assert.match(diagnostic, /conversion failed/); }
  else await assert.rejects(operation, error => mode === "output-limit" ? error instanceof RangeError : error === failure);
  if (mode !== "sink") assert.equal(writes, 0);
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["input.odt"]);
});

for (const extension of ["odt", "ods", "odp"]) for (const format of ["txt", "md"]) it(`retains ${extension} to ${format} conversion with table and paragraph spacing`, async () => {
  const fs = new MemoryFileSystem(), path = `/input.${extension}`;
  const xml = '<office><text:h>Title</text:h><text:p>Body &amp; text</text:p><table:table><table:table-row><table:table-cell>A</table:table-cell><table:table-cell>B</table:table-cell></table:table-row><table:table-row><table:table-cell>C</table:table-cell></table:table-row></table:table><text:p>End</text:p></office>';
  const bytes = createStoredZipArchive({ "content.xml": encode(xml) }), files = new Map([[path, bytes]]);
  await fs.writeFile(path, bytes);
  const args = ["--convert-to", format, path], expected = await runSofficeCli(args, files);
  const filesystem = new Proxy(fs, { get(target, key) {
    if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file I/O forbidden"); };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  let stdout = "", stderr = "";
  const actual = await runSofficeFileCli(args, { filesystem,
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
  assert.deepEqual({ ...actual, stdout, stderr }, expected);
  assert.deepEqual(await fs.readFile(`/input.${format}`), files.get(`/input.${format}`));
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name).sort(), [`input.${extension}`, `input.${format}`].sort());
});

// Independent ZIP/DEFLATE vector generated with Python's zipfile, not the package codec.
it("extracts a compressed OpenDocument member across many decoder chunks", async () => {
  const bytes = Uint8Array.from(atob("UEsDBBQAAAAIAAAAIQBDSDjbqgAAAGKcAAALAAAAY29udGVudC54bWztyDEKgzAUANCrBARXaSkOGgLtTYrkg0MxQ4Yc34P0vfHlK+I8asm9jr618k7z99f29EnzNB6xvp57cs4555xzzjnnnHPOOeecc84555xzzjnnnHPOOeecc84555xzzjnnnHPOOeecc84555xzzjnnnHPOOeecc84555xzzjnnnHPOOeecc84555xzzjnnnHPOOeecc84555xz7l8vL72OvrWSlyviPGq5AVBLAQIUAxQAAAAIAAAAIQBDSDjbqgAAAGKcAAALAAAAAAAAAAAAAACAAQAAAABjb250ZW50LnhtbFBLBQYAAAAAAQABADkAAADTAAAAAAA="), value => value.charCodeAt(0));
  const fs = new MemoryFileSystem(); await fs.writeFile("/input.odt", bytes);
  const decoder = new TextDecoder(); let output = "";
  const result = await runSofficeFileCli(["--cat", "/input.odt"], { filesystem: fs,
    stdout: { async write(bytes) { output += decoder.decode(bytes, { stream: true }); } },
    stderr: { async write(bytes) { assert.fail(new TextDecoder().decode(bytes)); } } });
  output += decoder.decode();
  assert.equal(result.exitCode, 0); assert.equal(output, "A & B 🙂 ".repeat(2000).trimEnd() + "\n");
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["input.odt"]);
});

for (const inputs of [["/bad.odt", "/missing"], ["/missing", "/bad.odt"]]) it(`preserves operand error order: ${inputs.join(", ")}`, async () => {
  const fs = new MemoryFileSystem();
  const bytes = createStoredZipArchive({ "content.xml": encode('<office><text:p>&#x110000;</text:p></office>') });
  await fs.writeFile("/bad.odt", bytes);
  const expected = await runSofficeCli(["--cat", ...inputs], new Map([["/bad.odt", bytes]]));
  let stdout = "", stderr = "";
  const actual = await runSofficeFileCli(["--cat", ...inputs], { filesystem: fs,
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
  assert.deepEqual({ ...actual, stdout, stderr }, expected);
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["bad.odt"]);
});
