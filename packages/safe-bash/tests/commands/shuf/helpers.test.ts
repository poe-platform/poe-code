import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import childProcess from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { EventEmitter } from "node:events";
import { PassThrough, Readable } from "node:stream";
import { test, type TestContext } from "node:test";
import * as helpers from "./helpers.js";

const executable = Buffer.from("reviewed test executable");
const digest = createHash("sha256").update(executable).digest("hex");

function fixture(context: TestContext) {
  const originalPath = process.env.SAFE_BASH_TEST_SHUF;
  const originalHash = process.env.SAFE_BASH_TEST_SHUF_SHA256;
  process.env.SAFE_BASH_TEST_SHUF = `/mock/shuf/${context.name}`;
  process.env.SAFE_BASH_TEST_SHUF_SHA256 = digest;
  context.mock.method(fs, "lstatSync", () => ({ isFile: () => true, size: executable.length }));
  context.mock.method(fs, "createReadStream", () => Readable.from([executable]));
  context.after(() => {
    if (originalPath === undefined) delete process.env.SAFE_BASH_TEST_SHUF;
    else process.env.SAFE_BASH_TEST_SHUF = originalPath;
    if (originalHash === undefined) delete process.env.SAFE_BASH_TEST_SHUF_SHA256;
    else process.env.SAFE_BASH_TEST_SHUF_SHA256 = originalHash;
    context.mock.restoreAll();
    syncBuiltinESMExports();
  });
  syncBuiltinESMExports();
}

test("oracle path has no implicit ephemeral default", () => {
  assert.equal(helpers.oraclePath, process.env.SAFE_BASH_TEST_SHUF);
  assert.equal(Boolean(helpers.nativeOptions.skip), process.env.SAFE_BASH_TEST_SHUF === undefined);
});

for (const missing of ["SAFE_BASH_TEST_SHUF", "SAFE_BASH_TEST_SHUF_SHA256"] as const) {
  test(`oracle requires explicit ${missing}`, async context => {
    fixture(context);
    delete process.env[missing];
    await assert.rejects(helpers.authenticateOracle(), new RegExp(missing));
  });
}

test("oracle rejects an explicitly empty path", async context => {
  fixture(context);
  process.env.SAFE_BASH_TEST_SHUF = "";
  await assert.rejects(helpers.authenticateOracle(), /SAFE_BASH_TEST_SHUF/);
});

test("oracle rejects a missing supplied executable", async context => {
  fixture(context);
  const failure = new Error("missing supplied executable");
  context.mock.method(fs, "lstatSync", () => { throw failure; });
  syncBuiltinESMExports();
  await assert.rejects(helpers.authenticateOracle(), error => error === failure);
});

test("oracle rejects a mismatched supplied hash", async context => {
  fixture(context);
  process.env.SAFE_BASH_TEST_SHUF_SHA256 = "0".repeat(64);
  await assert.rejects(helpers.authenticateOracle(), /hash mismatch/);
});

for (const channel of [1, 2, 4]) {
  test(`oracle bounds FD${channel} and waits for close before rejection`, async context => {
    fixture(context);
    const child = new EventEmitter();
    const streams = Array.from({ length: 5 }, () => new PassThrough());
    let kills = 0;
    Object.assign(child, { stdio: streams, stdin: streams[0], stdout: streams[1], stderr: streams[2], kill() { kills++; } });
    let launch!: () => void;
    const launched = new Promise<void>(resolve => { launch = resolve; });
    context.mock.method(childProcess, "spawn", () => { launch(); return child; });
    syncBuiltinESMExports();
    let settled = false;
    let captured = false;
    const result = helpers.native([], undefined, undefined, undefined, () => { captured = true; });
    const checked = assert.rejects(result, /output limit/).finally(() => { settled = true; });
    await launched;
    streams[channel]!.emit("data", Buffer.alloc(1024 * 1024 + 1));
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(kills, 1);
    assert.equal(settled, false);
    streams[channel]!.emit("data", Buffer.alloc(1024 * 1024 + 1));
    child.emit("close", null, "SIGKILL");
    await checked;
    assert.equal(kills, 1);
    assert.equal(captured, false);
  });
}

for (const failureKind of ["timeout", "spawn error", "stream error", "stdin error", "entropy error"]) {
  test(`oracle ${failureKind} waits for close and clears its timer`, async context => {
    fixture(context);
    const child = new EventEmitter();
    const streams = Array.from({ length: 5 }, () => new PassThrough());
    let kills = 0;
    Object.assign(child, { stdio: streams, stdin: streams[0], stdout: streams[1], stderr: streams[2], kill() { kills++; } });
    let launch!: () => void;
    const launched = new Promise<void>(resolve => { launch = resolve; });
    context.mock.method(childProcess, "spawn", () => { launch(); return child; });
    let timeout: (() => void) | undefined;
    const timer = {};
    context.mock.method(globalThis, "setTimeout", (callback: () => void) => { timeout = callback; return timer; });
    const clear = context.mock.method(globalThis, "clearTimeout", () => {});
    syncBuiltinESMExports();
    let settled = false;
    const result = helpers.native([]);
    const checked = assert.rejects(result, failureKind === "timeout" ? /two seconds/ : /fixture failure/).finally(() => { settled = true; });
    await launched;
    if (failureKind === "timeout") timeout!();
    else if (failureKind === "spawn error") child.emit("error", new Error("fixture failure"));
    else streams[failureKind === "stdin error" ? 0 : failureKind === "entropy error" ? 3 : 4]!.emit("error", new Error("fixture failure"));
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(settled, false);
    assert.equal(kills, 1);
    child.emit("close", null, "SIGKILL");
    await checked;
    assert.equal(clear.mock.callCount(), 1);
    assert.equal(clear.mock.calls[0]!.arguments[0], timer);
  });
}

test("oracle drains all output through close, not just process exit", async context => {
  fixture(context);
  const child = new EventEmitter();
  const streams = Array.from({ length: 5 }, () => new PassThrough());
  Object.assign(child, { stdio: streams, stdin: streams[0], stdout: streams[1], stderr: streams[2], kill() { assert.fail("unexpected kill"); } });
  let launch!: () => void;
  const launched = new Promise<void>(resolve => { launch = resolve; });
  context.mock.method(childProcess, "spawn", () => { launch(); return child; });
  syncBuiltinESMExports();
  let settled = false;
  let captured: Buffer | undefined;
  const result = helpers.native([], undefined, undefined, undefined, bytes => { captured = bytes; }).finally(() => { settled = true; });
  await launched;
  child.emit("exit", 0, null);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  for (const channel of [1, 2, 4]) {
    const chunk = Buffer.from([channel, 255]);
    streams[channel]!.emit("data", chunk);
    chunk.fill(0);
    streams[channel]!.emit("data", Buffer.from([128]));
  }
  child.emit("close", 0, null);
  assert.deepEqual(await result, { exitCode: 0, stdout: Buffer.from([1, 255, 128]), stderr: Buffer.from([2, 255, 128]).toString(), stderrHex: "02ff80" });
  assert.deepEqual(captured, Buffer.from([4, 255, 128]));
});
