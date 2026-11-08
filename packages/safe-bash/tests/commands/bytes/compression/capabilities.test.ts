import assert from "node:assert/strict";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import { run, wrap } from "./helpers.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";

for (const [command, suffix] of [["gzip", ".gz"], ["bzip2", ".bz2"], ["xz", ".xz"], ["zstd", ".zst"]]) {
  test(`${command}: atomic no-replace alone admits a new target`, async () => {
    const memory = createMemoryFileSystem();
    await memory.writeFile("/input", Buffer.from("hello\n"));
    const capabilities = { ...memory.capabilities, atomicRename: false, atomicRenameNoReplace: true };
    let renamed = 0;
    const fs = wrap(memory, {
      capabilities,
      async capabilitiesFor() { return capabilities; },
      async copyFile() { assert.fail("non-atomic copy publication must not be used"); },
      async rename(source, destination, options) {
        renamed++;
        assert.equal(options?.noReplace, true);
        await memory.rename(source, destination, options);
      },
    });
    const result = await run(command!, ["-k", "input"], undefined, { fs });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(renamed, 1);
    assert.deepEqual((await memory.readdir("/")).map(entry => entry.name).sort(), ["input", "input" + suffix]);
    if (command === "gzip") assert.equal(gunzipSync(await memory.readFile("/input.gz")).toString(), "hello\n");
  });

  test(`${command}: stdout does not require file-publication capabilities`, async () => {
    const memory = createMemoryFileSystem();
    await memory.writeFile("/input", Buffer.from("hello\n"));
    const capabilities = { ...memory.capabilities, atomicRename: false, atomicRenameNoReplace: false, exclusiveCreate: false };
    const fs = wrap(memory, { capabilities, async capabilitiesFor() { return capabilities; }, async mkdir() { assert.fail("stdout cannot acquire a stage"); } });
    const result = await run(command!, ["-c", "input"], undefined, { fs });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.ok(result.stdout.length > 0);
    assert.deepEqual((await memory.readdir("/")).map(entry => entry.name), ["input"]);
  });
}
