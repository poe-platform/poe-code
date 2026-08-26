import assert from "node:assert/strict";
import test from "node:test";
import { FsError, type FileSystem } from "../../src/contracts/index.js";
import { fixture, run } from "./helpers.js";

function withoutTimestamps(backing: FileSystem, present: boolean) {
  let calls = 0;
  const fs = new Proxy(backing, {
    get(target, property) {
      if (property === "capabilities") return { ...target.capabilities, timestamps: false };
      if (property === "utimes") return present ? async () => { calls++; throw new FsError("ENOTSUP", { syscall: "utimes" }); } : undefined;
      const member: unknown = Reflect.get(target, property, target);
      return typeof member === "function" ? member.bind(target) : member;
    },
  });
  return { fs, calls: () => calls };
}

for (const present of [false, true]) {
  test(`plain new-file touch needs no timestamp mutation, optional method present=${present}`, async () => {
    const backing = await fixture();
    const observed = withoutTimestamps(backing, present);
    for (const [index, flags] of [[], ["-a"], ["-m"], ["-am"]].entries()) {
      const name = `created-${index}`;
      const result = await run("touch", [...flags, name], { fs: observed.fs });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.deepEqual(await backing.readFile(`/work/${name}`), new Uint8Array());
    }
    assert.equal(observed.calls(), 0);
  });

  test(`existing touch still requires timestamp support, optional method present=${present}`, async () => {
    const backing = await fixture({ existing: "keep" });
    await backing.utimes!("/work/existing", 100, 200);
    const observed = withoutTimestamps(backing, present);
    const before = await backing.stat("/work/existing");
    const result = await run("touch", ["existing"], { fs: observed.fs });
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /ENOTSUP/u);
    const after = await backing.stat("/work/existing");
    assert.equal(after.atimeMs, before.atimeMs);
    assert.equal(after.mtimeMs, before.mtimeMs);
    assert.equal(Buffer.from(await backing.readFile("/work/existing")).toString(), "keep");
    assert.equal(observed.calls(), present ? 1 : 0);
  });
}

test("reference timestamps remain explicit, including new-file creation", async () => {
  const fs = await fixture({ reference: "reference" });
  await fs.utimes("/work/reference", 123, 456);
  const result = await run("touch", ["-r", "reference", "created"], { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  const stat = await fs.stat("/work/created");
  assert.equal(stat.atimeMs, 123);
  assert.equal(stat.mtimeMs, 456);
});

test("absent reference-time operation fails before creating a partial target", async () => {
  const backing = await fixture({ reference: "reference" });
  const observed = withoutTimestamps(backing, false);
  const result = await run("touch", ["-r", "reference", "created"], { fs: observed.fs });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /ENOTSUP/u);
  await assert.rejects(backing.stat("/work/created"), { code: "ENOENT" });
});

test("no-create and cancelled touch leave the namespace unchanged", async () => {
  const backing = await fixture();
  const observed = withoutTimestamps(backing, true);
  assert.equal((await run("touch", ["-c", "missing"], { fs: observed.fs })).exitCode, 0);
  const controller = new AbortController();
  const reason = new Error("cancel touch");
  controller.abort(reason);
  await assert.rejects(run("touch", ["cancelled"], { fs: observed.fs, signal: controller.signal }), error => error === reason);
  assert.deepEqual(await backing.readdir("/work"), []);
  assert.equal(observed.calls(), 0);
});
