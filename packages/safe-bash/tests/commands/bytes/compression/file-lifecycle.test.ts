import assert from "node:assert/strict";
import test from "node:test";
import { run, wrap } from "./helpers.js";
import { FsError, type InvocationCleanup } from "../../../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";

for (const [command, suffix] of [["bzip2", ".bz2"], ["xz", ".xz"], ["zstd", ".zst"]]) {
  test(`${command}: register owned cleanup before staging acquisition`, async context => {
    const memory = createMemoryFileSystem();
    await memory.writeFile("/input", Buffer.from("hello\n"));
    const cleanups: InvocationCleanup[] = [];
    let registeredAtMkdir = -1;
    const fs = wrap(memory, {
      async mkdir(path, options) { registeredAtMkdir = cleanups.length; await memory.mkdir(path, options); },
    });
    const result = await run(command!, ["-k", "input"], undefined, { fs, registerCleanup: cleanup => { cleanups.push(cleanup); } });
    context.diagnostic("LIFECYCLE " + JSON.stringify({ command, probe: "cleanup-before-acquisition", status: result.exitCode, registeredAtMkdir, cleanupCount: cleanups.length }));
    assert.equal(result.exitCode, 0, result.stderr);
    assert.ok(registeredAtMkdir > 0, "staging acquisition lacks invocation-owned cleanup registration");
  });

  test(`${command}: cleanup preserves a foreign entry arriving after empty listing`, async context => {
    const memory = createMemoryFileSystem();
    await memory.writeFile("/input", Buffer.from("hello\n"));
    let foreign = "";
    let recursiveRemovals = 0;
    const fs = wrap(memory, {
      async readdir(path, options) {
        const entries = await memory.readdir(path, options);
        if (path.includes(".virtual-bash-gzip-") && entries.length === 0) {
          foreign = path + "/foreign";
          await memory.writeFile(foreign, Buffer.from("other owner"));
        }
        return entries;
      },
      async rm(path, options) { if (options?.recursive) recursiveRemovals++; await memory.rm(path, options); },
      async rmdir(path, options) {
        foreign = path + "/foreign";
        await memory.writeFile(foreign, Buffer.from("other owner"));
        await memory.rmdir(path, options);
      },
    });
    const result = await run(command!, ["input"], undefined, { fs });
    assert.notEqual(foreign, "", "race must actually be reached");
    const foreignSurvives = await memory.lstat(foreign).then(() => true, () => false);
    const inputSurvives = await memory.lstat("/input").then(() => true, () => false);
    context.diagnostic("LIFECYCLE " + JSON.stringify({ command, probe: "foreign-entry-after-listing", status: result.exitCode, foreignSurvives, inputSurvives, recursiveRemovals }));
    assert.equal(foreignSurvives, true, "cleanup must never recursively delete another owner's late entry");
  });

  test(`${command}: failed non-atomic publication exposes no partial destination`, async context => {
    const memory = createMemoryFileSystem();
    await memory.writeFile("/input", Buffer.from("hello\n"));
    let publicationCopies = 0;
    const capabilities = { ...memory.capabilities, atomicRename: false, atomicRenameNoReplace: false };
    const fs = wrap(memory, {
      capabilities,
      async capabilitiesFor() { return capabilities; },
      async copyFile(source, destination, options) {
        publicationCopies++;
        assert.equal(options?.exclusive, true);
        const bytes = await memory.readFile(source);
        await memory.writeFile(destination, bytes.subarray(0, 1), { flag: "wx" });
        throw new FsError("EIO", { message: "partial non-atomic copy" });
      },
    });
    const result = await run(command!, ["input"], undefined, { fs });
    const targetBytes = await memory.readFile("/input" + suffix).then(bytes => Buffer.from(bytes).toString("hex"), () => null);
    const sourceBytes = Buffer.from(await memory.readFile("/input")).toString("hex");
    context.diagnostic("LIFECYCLE " + JSON.stringify({ command, probe: "partial-nonatomic-publication", status: result.exitCode, publicationCopies, targetBytes, sourceBytes }));
    assert.equal(sourceBytes, Buffer.from("hello\n").toString("hex"));
    assert.equal(targetBytes, null, "without positive atomic publication capability, refuse before exposing target bytes");
  });
}
