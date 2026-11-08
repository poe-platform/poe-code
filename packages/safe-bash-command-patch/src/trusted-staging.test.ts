import assert from "node:assert/strict";
import test from "node:test";
import type { FileStaging, FileStagingEntry } from "safe-bash-contracts";
import { contents, filesystem, run } from "./helpers.test.js";

for (const writer of [true, false]) test(`retained staging validates an unadvertised writer: ${writer}`, async t => {
  const fs = await filesystem({ target: "old\n" });
  Object.defineProperty(fs, "capabilities", { value: { ...fs.capabilities, retainedStagingWrite: undefined } });
  const create = fs.createStagedFile.bind(fs);
  t.mock.method(fs, "createStagedFile", async (...args: Parameters<typeof create>) => {
    assert.equal(args[3].retainCleanup, true);
    const staging = { ...await create(...args) };
    if (!writer) delete staging.writer;
    return staging;
  });
  const conditional = t.mock.method(fs, "writeFileConditional", async () => { throw new Error("retained writer required"); });
  const result = await run("patch", [], { fs, input: "--- target\n+++ target\n@@ -1 +1 @@\n-old\n+new\n" });
  assert.equal(result.exitCode, writer ? 0 : 2, result.stderr);
  if (!writer) assert.ok(result.stderr.includes("filesystem does not support retained staging writes"));
  assert.equal(conditional.mock.callCount(), 0);
  assert.equal(await contents(fs, "target"), writer ? "new\n" : "old\n");
  assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name), ["target"]);
});

for (const atomicStagingAncestry of [false, true]) for (const failure of ["none", "write", "cancel", "publish", "destination"] as const) {
  test(`conditional staging streams and cleans ownership (ancestry=${atomicStagingAncestry}): ${failure}`, async t => {
    const old = "a".repeat(40000), next = "b".repeat(40000);
    const fs = await filesystem({ target: `${old}\n` });
    await fs.chmod("/work/target", 0o640);
    const capabilities = { ...fs.capabilities, atomicStagingAncestry,
      trustedOwnedStaging: !atomicStagingAncestry, retainedStagingCleanup: false, retainedStagingWrite: false };
    Object.defineProperty(fs, "capabilities", { value: capabilities });
    const owned = new WeakMap<FileStagingEntry, FileStaging>();
    const authenticate = (receipt: FileStaging) => {
      const original = owned.get(receipt.directory);
      assert.ok(original, "directory entry must carry authentic staging ownership");
      assert.equal(receipt.parent, original.parent);
      assert.equal(receipt.file.path, original.file.path);
    };
    const create = fs.createStagedFile.bind(fs);
    t.mock.method(fs, "createStagedFile", async (...args: Parameters<typeof create>) => {
      assert.deepEqual(Object.keys(args[3]).sort(), ["mode", "parent", "signal"], "caller hosts reject unsupported option keys, even false values");
      assert.equal(args[2].type, "file");
      if (args[2].type === "file") assert.equal(args[2].data.length, 0);
      const receipt = await create(...args);
      Object.freeze(receipt.parent);
      Object.freeze(receipt.directory);
      Object.freeze(receipt.file);
      Object.freeze(receipt);
      owned.set(receipt.directory, receipt);
      return receipt;
    });
    const remove = fs.removeStagedFile.bind(fs);
    t.mock.method(fs, "removeStagedFile", async (...args: Parameters<typeof remove>) => {
      authenticate(args[0]);
      await remove(...args);
      owned.delete(args[0].directory);
    });
    const publish = fs.publishStagedFile.bind(fs);
    t.mock.method(fs, "publishStagedFile", async (...args: Parameters<typeof publish>) => {
      authenticate(args[0]);
      assert.notEqual(args[0], owned.get(args[0].directory), "publication carries a refreshed file receipt");
      assert.equal(Boolean(args[2].ancestors?.length), atomicStagingAncestry);
      assert.ok(args[2].destination, "publication retains authoritative destination identity");
      assert.throws(() => authenticate({ ...args[0], directory: { ...args[0].directory } }));
      assert.throws(() => authenticate({ ...args[0], parent: { ...args[0].parent } }));
      assert.throws(() => authenticate({ ...args[0], file: { ...args[0].file, path: "/foreign" } }));
      if (failure === "publish") throw new Error("publication refused");
      if (failure === "destination") await fs.writeFile("/work/target", new TextEncoder().encode("concurrent\n"));
      return publish(...args);
    });
    const write = fs.writeFileConditional.bind(fs);
    const controller = new AbortController(), reason = new Error("trusted write stopped");
    let writes = 0;
    t.mock.method(fs, "writeFileConditional", async (...args: Parameters<typeof write>) => {
      assert.ok(args[1].length <= 16384, "publication must stay bounded");
      assert.equal(args[2].append, true);
      assert.equal(args[2].mode, 0o640, "each write restores the requested publication mode");
      assert.ok(args[2].expected, "each chunk retains the previous staging identity");
      if (++writes === 2) {
        if (failure === "write") throw reason;
        if (failure === "cancel") { controller.abort(reason); throw reason; }
      }
      return write(...args);
    });
    const result = run("patch", [], { fs, signal: controller.signal,
      input: `--- target\n+++ target\n@@ -1 +1 @@\n-${old}\n+${next}\n` });
    if (failure === "cancel") await assert.rejects(result, error => error === reason);
    else {
      const output = await result;
      assert.equal(output.exitCode, failure === "none" ? 0 : 2, output.stderr);
    }
    assert.ok(writes >= 2);
    assert.equal(await contents(fs, "target"), `${failure === "none" ? next : failure === "destination" ? "concurrent" : old}\n`);
    assert.equal((await fs.stat("/work/target")).mode & 0o777, 0o640);
    assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name), ["target"]);
  });
}

test("trusted staging requires conditional writes before creating output", async t => {
  const fs = await filesystem({ target: "old\n" });
  Object.defineProperty(fs, "capabilities", { value: { ...fs.capabilities,
    atomicStagingAncestry: false, trustedOwnedStaging: true } });
  Object.defineProperty(fs, "writeFileConditional", { value: undefined });
  const create = t.mock.method(fs, "createStagedFile");
  const result = await run("patch", [], { fs, input: "--- target\n+++ target\n@@ -1 +1 @@\n-old\n+new\n" });
  assert.equal(result.exitCode, 2);
  assert.equal(result.stderr, "patch: filesystem does not support race-safe patch publication\n");
  assert.equal(create.mock.callCount(), 0);
  assert.equal(await contents(fs, "target"), "old\n");
  assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name), ["target"]);
});

test("caller-backed conditional staging refuses a changed destination", async t => {
  const fs = await filesystem({ target: "old\n" });
  Object.defineProperty(fs, "capabilities", { value: { ...fs.capabilities,
    retainedStagingCleanup: false, retainedStagingWrite: false } });
  const publish = fs.publishStagedFile.bind(fs);
  t.mock.method(fs, "publishStagedFile", async (...args: Parameters<typeof publish>) => {
    await fs.writeFile("/work/target", new TextEncoder().encode("concurrent\n"));
    return publish(...args);
  });
  const result = await run("patch", [], { fs, input: "--- target\n+++ target\n@@ -1 +1 @@\n-old\n+new\n" });
  assert.equal(result.exitCode, 2);
  assert.equal(await contents(fs, "target"), "concurrent\n");
  assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name), ["target"]);
});

test("caller-backed staging refuses unsupported conditional writes before creation", async t => {
  const fs = await filesystem({ target: "old\n" });
  Object.defineProperty(fs, "capabilities", { value: { ...fs.capabilities,
    retainedStagingCleanup: false, retainedStagingWrite: false, atomicFileMutation: false } });
  const create = t.mock.method(fs, "createStagedFile");
  const result = await run("patch", [], { fs, input: "--- target\n+++ target\n@@ -1 +1 @@\n-old\n+new\n" });
  assert.equal(result.exitCode, 2);
  assert.equal(create.mock.callCount(), 0);
  assert.equal(await contents(fs, "target"), "old\n");
});
