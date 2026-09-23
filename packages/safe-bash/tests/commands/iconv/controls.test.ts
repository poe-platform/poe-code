import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { run } from "./helpers.js";

const input = new TextEncoder().encode("Changed café\n");
const expected = "004300680061006e006700650064002000630061006600e9000a";

for (const flag of ["-s", "--silent", "-sfUTF-8"]) {
  for (const file of [false, true]) test(`iconv ${flag} preserves ${file ? "file" : "stdin"} conversion`, async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/source", input);
    const result = await run([flag, "-f", "UTF-8", "-t", "UTF-16BE", ...(file ? ["source"] : [])], input, {}, { fs });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdoutHex, expected);
    assert.equal(result.stderrHex, "");
  });
}

for (const files of [[], ["-"], ["source"], ["source", "source"], ["source", "-"]]) {
  test(`iconv verbose reports named input progress: ${JSON.stringify(files)}`, async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/source", input);
    const result = await run(["--silent", "--verbose", "-f", "UTF-8", "-t", "UTF-16BE", ...files], input, {}, { fs });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdoutHex, expected.repeat(Math.max(1, files.length)));
    assert.equal(Buffer.from(result.stderrHex, "hex").toString(), files.filter(file => file !== "-").map(file => `${file}:\n`).join(""));
  });
}

test("iconv silent preserves fatal diagnostics and failure status", async () => {
  const normal = await run(["-f", "UTF-8", "-t", "ASCII"], input);
  const silent = await run(["--silent", "-f", "UTF-8", "-t", "ASCII"], input);
  assert.equal(normal.exitCode, 1);
  assert.deepEqual(silent, normal);
});
