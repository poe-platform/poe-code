import assert from "node:assert/strict";
import test from "node:test";
import { contents, filesystem, run } from "./helpers.test.js";

for (const atomicStagingAncestry of [false, true]) for (const failure of ["none", "write", "cancel"] as const) {
  test(`conditional staging streams and cleans ownership (ancestry=${atomicStagingAncestry}): ${failure}`, async t => {
    const old = "a".repeat(40000), next = "b".repeat(40000);
    const fs = await filesystem({ target: `${old}\n` });
    await fs.chmod("/work/target", 0o640);
    const capabilities = { ...fs.capabilities, atomicStagingAncestry,
      trustedOwnedStaging: !atomicStagingAncestry, retainedStagingCleanup: false, retainedStagingWrite: false };
    Object.defineProperty(fs, "capabilities", { value: capabilities });
    const create = fs.createStagedFile.bind(fs);
    t.mock.method(fs, "createStagedFile", async (...args: Parameters<typeof create>) => {
      assert.notEqual(args[3].retainCleanup, true, "trusted hosts need no retained cleanup capability");
      assert.equal(args[2].type, "file");
      if (args[2].type === "file") assert.equal(args[2].data.length, 0);
      return create(...args);
    });
    const publish = fs.publishStagedFile.bind(fs);
    t.mock.method(fs, "publishStagedFile", async (...args: Parameters<typeof publish>) => {
      assert.equal(Boolean(args[2].ancestors?.length), atomicStagingAncestry);
      assert.ok(args[2].destination, "publication retains authoritative destination identity");
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
    assert.equal(await contents(fs, "target"), `${failure === "none" ? next : old}\n`);
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
