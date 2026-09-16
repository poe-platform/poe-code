import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import { PassThrough } from "node:stream";
import test, { type TestContext } from "node:test";
import { native } from "./helpers.js";

function fixture(context: TestContext) {
  const previous = process.env.CMP_ORACLE;
  process.env.CMP_ORACLE = "/explicit/mock/gnu-cmp";
  const child = Object.assign(new EventEmitter(), {
    pid: 123456, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
    stdio: [null, null, null, new PassThrough()],
  });
  context.mock.method(childProcess, "spawn", () => child);
  const kills: unknown[][] = [];
  context.mock.method(process, "kill", (...args: unknown[]) => {
    kills.push(args);
    queueMicrotask(() => child.emit("close", null, "SIGKILL"));
    return true;
  });
  syncBuiltinESMExports();
  context.after(() => {
    if (previous === undefined) delete process.env.CMP_ORACLE;
    else process.env.CMP_ORACLE = previous;
    context.mock.restoreAll();
    syncBuiltinESMExports();
  });
  return { child, kills };
}

test("native oracle requires an explicit environment prerequisite", async context => {
  const previous = process.env.CMP_ORACLE;
  delete process.env.CMP_ORACLE;
  context.after(() => { if (previous !== undefined) process.env.CMP_ORACLE = previous; });
  const spawn = context.mock.method(childProcess, "spawn", () => { throw new Error("unexpected subprocess"); });
  syncBuiltinESMExports();
  context.after(() => { context.mock.restoreAll(); syncBuiltinESMExports(); });
  await assert.rejects(native(["--version"]), /CMP_ORACLE/);
  assert.equal(spawn.mock.callCount(), 0);
});

for (const exitCode of [0, 1, 2]) {
  test(`native oracle never signals a fully closed process group: status ${exitCode}`, async context => {
    const { child } = fixture(context);
    const kill = context.mock.method(process, "kill", () => {
      throw Object.assign(new Error("lost process-group ownership"), { code: "EPERM" });
    });
    const operation = native(["--version"]);
    child.emit("close", exitCode, null);
    assert.deepEqual(await operation, { exitCode, stdout: "", stderr: "" });
    child.stderr.emit("error", new Error("late stream notification"));
    assert.equal(kill.mock.callCount(), 0);
    assert.equal(child.stdin.destroyed, true);
    assert.equal(child.stdio[3]!.destroyed, true);
  });
}

test("native timeout signals owned descendants but waits for complete close", async context => {
  const { child } = fixture(context);
  const kill = context.mock.method(process, "kill", () => true);
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let settled = false;
  const operation = assert.rejects(native(["--version"]), /timed out/).then(() => { settled = true; });
  child.emit("exit", 0, null);
  context.mock.timers.tick(3000);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.deepEqual(kill.mock.calls.map(call => call.arguments), [[-123456, "SIGKILL"]]);
  assert.equal(settled, false);
  assert.equal(child.stdin.destroyed, true);
  assert.equal(child.stdio[3]!.destroyed, true);
  child.emit("close", 0, null);
  await operation;
  assert.equal(kill.mock.callCount(), 1);
});

test("native early exit permits Darwin socket peer closure while retaining exact output", async context => {
  const { child, kills } = fixture(context);
  const operation = native(["-b", "/dev/fd/3", "-"], Buffer.from("a"), Buffer.from("b"));
  child.stdout.emit("data", Buffer.from("/dev/fd/3 - differ: byte 1, line 1 is 141 a 142 b\n"));
  child.stdio[3]!.emit("error", Object.assign(new Error("write ENOTCONN"), { code: "ENOTCONN" }));
  child.emit("close", 1, null);
  assert.deepEqual(await operation, {
    exitCode: 1, stdout: "/dev/fd/3 - differ: byte 1, line 1 is 141 a 142 b\n", stderr: "",
  });
  assert.deepEqual(kills, []);
});

test("native oracle bounds output and kills its process group before rejecting", async context => {
  const { child, kills } = fixture(context);
  const operation = assert.rejects(native(["--version"]), /output.*limit/);
  child.stdout.emit("data", Buffer.alloc(1048577));
  await operation;
  assert.deepEqual(kills, [[-123456, "SIGKILL"]]);
});

test("native oracle timeout cleans child and pipe descendants", async context => {
  const { kills } = fixture(context);
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const operation = assert.rejects(native(["--version"]), /timed out/);
  context.mock.timers.tick(3000);
  await operation;
  assert.deepEqual(kills, [[-123456, "SIGKILL"]]);
});

test("native oracle reaps subprocess error and signal exits", async context => {
  const { child, kills } = fixture(context);
  const failure = new Error("oracle spawn failure");
  const operation = assert.rejects(native(["--version"]), error => error === failure);
  child.emit("error", failure);
  await operation;
  assert.deepEqual(kills, [[-123456, "SIGKILL"]]);
});
