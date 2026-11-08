import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { lstatSync, readFileSync } from "node:fs";
import { PassThrough } from "node:stream";
import test from "node:test";
import ts from "typescript";
import { jobsNativeProfile } from "./cases.js";

interface Result {
  exitCode: number;
  stdout: Buffer;
  stderr: Buffer;
}

type Child = ReturnType<typeof childFixture>;
type Collect = (child: Child, input: { input?: string; releaseOn?: string },
  terminate: (pid: number) => void, deadline?: (expire: () => void) => () => void) => Promise<Result>;

function childFixture() {
  return Object.assign(new EventEmitter(), {
    pid: 901, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), control: new PassThrough(),
  });
}

function collectorFixture() {
  const location = new URL("./native.test.ts", import.meta.url);
  const stat = lstatSync(location);
  assert.ok(stat.isFile() && stat.size <= 32768);
  const source = ts.createSourceFile("native.test.ts", readFileSync(location, "utf8"), ts.ScriptTarget.ES2022, true);
  const declarations = source.statements.filter(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === "collectChild");
  assert.equal(declarations.length, 1);
  const javascript = ts.transpileModule(declarations[0]!.getText(source), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const timers = new Map<number, () => void>();
  let nextTimer = 0;
  const collect = new Function("jobsNativeProfile", "Buffer", "setTimeout", "clearTimeout", `${javascript}\nreturn collectChild;`)(
    jobsNativeProfile, Buffer,
    (callback: () => void) => { timers.set(++nextTimer, callback); return nextTimer; },
    (timer: number) => { timers.delete(timer); },
  ) as Collect;
  return { collect, timers };
}

test("independent supervision: split handshake releases exact input only after stdout marker", async () => {
  const { collect, timers } = collectorFixture();
  const child = childFixture();
  const input: Buffer[] = [];
  child.stdin.on("data", (bytes: Buffer) => { input.push(Buffer.from(bytes)); });
  const result = collect(child, { input: "go\u0000\n", releaseOn: "ready\n" }, () => assert.fail("unexpected signal"));
  child.stderr.write("ready\n");
  child.stdout.write("rea");
  assert.equal(child.stdin.writableEnded, false);
  child.stdout.write("dy\n");
  assert.equal(child.stdin.writableEnded, true);
  assert.deepEqual(Buffer.concat(input), Buffer.from("go\u0000\n"));
  child.control.once("finish", () => { child.emit("close", 7, null); });
  child.stdout.end("tail");
  child.stderr.end();
  assert.deepEqual(await result, { exitCode: 7, stdout: Buffer.from("ready\ntail"), stderr: Buffer.from("ready\n") });
  assert.equal(timers.size, 0);
});

test("independent supervision: successful close disarms stale deadline and late stream errors", async () => {
  const { collect, timers } = collectorFixture();
  const child = childFixture();
  const result = collect(child, {}, () => assert.fail("signal after successful ownership release"));
  const expire = [...timers.values()][0]!;
  child.control.once("finish", () => { child.emit("close", 0, null); });
  child.stdout.end();
  child.stderr.end();
  await result;
  expire();
  for (const stream of [child.stdin, child.stdout, child.stderr, child.control]) stream.emit("error", new Error("late failure"));
  child.emit("error", new Error("late child error"));
  assert.equal(timers.size, 0);
});

test("independent supervision: combined stdout and stderr budget is enforced before close", async () => {
  const { collect, timers } = collectorFixture();
  const child = childFixture();
  const signals: number[] = [];
  const result = collect(child, {}, pid => { signals.push(pid); });
  const rejected = assert.rejects(result, /output limit/u);
  child.stdout.write(Buffer.alloc(jobsNativeProfile.outputBytes));
  assert.deepEqual(signals, []);
  child.stderr.write(Buffer.from([255]));
  assert.deepEqual(signals, [child.pid]);
  child.emit("close", null, "SIGKILL");
  await rejected;
  assert.equal(timers.size, 0);
});

test("independent supervision: EOF without requested handshake fails and waits for close", async () => {
  const { collect, timers } = collectorFixture();
  const child = childFixture();
  let settled = false;
  const result = collect(child, { releaseOn: "missing\n" }, () => {});
  const rejected = assert.rejects(result, /handshake/u).then(() => { settled = true; });
  child.stdout.end();
  child.stderr.end();
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  assert.equal(child.stdin.writableEnded, false);
  child.emit("close", null, "SIGKILL");
  await rejected;
  assert.equal(timers.size, 0);
});

test("independent supervision: status zero before stream EOF cannot pass", async () => {
  const { collect, timers } = collectorFixture();
  const child = childFixture();
  const result = collect(child, {}, () => assert.fail("closed process must not be signalled"));
  const rejected = assert.rejects(result, /protocol/u);
  child.emit("close", 0, null);
  await rejected;
  child.stdout.destroy();
  child.stderr.destroy();
  assert.equal(timers.size, 0);
});

test("independent supervision: falsey stream failure remains the rejection reason", async () => {
  const { collect, timers } = collectorFixture();
  const child = childFixture();
  const signals: number[] = [];
  const result = collect(child, {}, pid => { signals.push(pid); });
  const rejected = assert.rejects(result, reason => { assert.equal(reason, 0); return true; });
  child.control.emit("error", 0);
  child.stderr.emit("error", new Error("secondary failure"));
  child.emit("close", null, "SIGKILL");
  await rejected;
  assert.deepEqual(signals, [child.pid]);
  assert.equal(timers.size, 0);
});

test("independent supervision: missing complete close is a bounded cleanup failure, never success", async () => {
  const { collect, timers } = collectorFixture();
  const child = childFixture();
  const failure = new Error("source failed");
  const signals: number[] = [];
  const result = collect(child, {}, pid => { signals.push(pid); });
  const rejected = assert.rejects(result, reason => {
    assert.ok(reason instanceof AggregateError);
    assert.deepEqual(reason.errors, [failure]);
    assert.match(reason.message, /cleanup.*deadline/u);
    return true;
  });
  child.stdout.emit("error", failure);
  const cleanupTimer = [...timers.entries()].at(-1)!;
  timers.delete(cleanupTimer[0]);
  cleanupTimer[1]();
  await rejected;
  child.emit("close", 0, null);
  assert.deepEqual(signals, [child.pid]);
  for (const stream of [child.stdin, child.stdout, child.stderr, child.control]) assert.equal(stream.destroyed, true);
  assert.equal(timers.size, 0);
});
