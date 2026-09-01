import assert from "node:assert/strict";
import test from "node:test";
import { getEventListeners } from "node:events";
import { createDuCommand, duCommands, type DuLimits } from "../../../src/commands/du/index.js";
import { FsError, type InvocationCleanup, type DirectoryEntry } from "../../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";
import { metadata, run, seed, trace, wrapped } from "./helpers.js";

const turn = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

for (const [limit, value] of Object.entries({ maxArguments: 1, maxArgumentBytes: 2, maxEntries: 1, maxDirectoryEntries: 1, maxDepth: 1, maxPathBytes: 3, maxMetadataBytes: 5, maxOutputBytes: 2, maxSteps: 5 })) {
  test(`bounded ${limit} fails explicitly without printing a complete total`, async () => {
    const fs = createMemoryFileSystem(); await seed(fs);
    const result = await run(["-bac", "tree"], { limits: { [limit]: value } }, { fs });
    assert.equal(result.exitCode, 1);
    assert.ok(!result.stdout.includes("\ttotal\n"));
    if (limit === "maxOutputBytes") assert.ok(Buffer.byteLength(result.stdout + result.stderr) <= value);
    else assert.match(result.stderr, /limit exceeded/u);
  });
}

test("all limit settings require positive safe integers", () => {
  for (const value of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, undefined]) {
    assert.throws(() => createDuCommand({ limits: { maxSteps: value } as Partial<DuLimits> }), /Invalid du limit/u);
  }
});

test("UTF-8 argument and output bytes, not character count, consume budgets", async () => {
  assert.equal((await run(["é"], { limits: { maxArgumentBytes: 1 } })).exitCode, 1);
  const fs = createMemoryFileSystem(); await fs.writeFile("/é", new Uint8Array(1));
  const result = await run(["-b", "é"], { limits: { maxOutputBytes: 4 } }, { fs });
  assert.equal(result.exitCode, 1); assert.equal(result.stdout, "");
  assert.ok(Buffer.byteLength(result.stderr) <= 4);
});

test("stdout and stderr share one output budget", async () => {
  const fs = createMemoryFileSystem(); await seed(fs);
  const result = await run(["-b", "tree/a", "missing"], { limits: { maxOutputBytes: 20 } }, { fs });
  assert.equal(result.stdout, "3\ttree/a\n"); assert.equal(result.exitCode, 1);
  assert.ok(Buffer.byteLength(result.stdout + result.stderr) <= 20);
});

test("malformed and oversized directory listings never escape the virtual tree", async () => {
  const base = createMemoryFileSystem(); await seed(base);
  for (const names of [[".."], ["."], [""], ["/outside"], ["a/b"], ["a\0b"], ["same", "same"]]) {
    const checked = trace(wrapped(base, { async readdir() { return names.map(name => ({ name, type: "file" })); } }));
    const result = await run(["-bc", "tree"], {}, { fs: checked.fs });
    assert.equal(result.exitCode, 1); assert.equal(result.stdout, "");
    assert.deepEqual(checked.calls.map(call => call.method), ["lstat", "readdir"]);
    assert.match(result.stderr, /invalid or duplicate directory/u);
  }
  const malformed = wrapped(base, { async readdir() { return [null] as unknown as DirectoryEntry[]; } });
  assert.equal((await run(["-b", "tree"], {}, { fs: malformed })).exitCode, 1);
});

test("safe depth remains enforced with --max-depth=0 and unknown identity", async () => {
  const base = createMemoryFileSystem(); await seed(base);
  const fs = metadata(base, stat => { const { identityScope: ignoredScope, dev: ignoredDev, ino: ignoredIno, ...rest } = stat; return rest; });
  const result = await run(["-bd0", "tree"], { limits: { maxDepth: 1 } }, { fs });
  assert.equal(result.exitCode, 1); assert.equal(result.stdout, "");
  assert.match(result.stderr, /depth limit/u);
});

test("sort comparisons consume bounded work rather than unbounded provider-name processing", async () => {
  const base = createMemoryFileSystem(); await base.mkdir("/dir");
  const fs = wrapped(base, { async readdir() {
    return Array.from({ length: 100 }, (_unused, index) => ({ name: `${"prefix".repeat(10)}${100 - index}`, type: "file" as const }));
  } });
  const result = await run(["-b", "dir"], { limits: { maxSteps: 10000 } }, { fs });
  assert.equal(result.exitCode, 1); assert.match(result.stderr, /work limit/u);
});

test("already aborted invocation preserves exact errno-shaped reason and performs no FS work", async () => {
  const controller = new AbortController(); const reason = new FsError("ENOENT"); controller.abort(reason);
  const checked = trace(createMemoryFileSystem());
  await assert.rejects(run(["-b"], {}, { fs: checked.fs, signal: controller.signal }), error => error === reason);
  assert.equal(checked.calls.length, 0);
});

test("registerCleanup precedes metadata admission; abort observes late opaque rejection", async () => {
  const base = createMemoryFileSystem(); await seed(base);
  const controller = new AbortController(); const reason = new FsError("EACCES");
  let cleanup: InvocationCleanup | undefined, rejectHost!: (error: unknown) => void;
  let entered!: () => void;
  const admitted = new Promise<void>(resolve => { entered = resolve; });
  const fs = wrapped(base, { async lstat(_path, options) {
    assert.ok(cleanup); assert.equal(options?.signal, controller.signal); entered();
    return new Promise((_resolve, reject) => { rejectHost = reject; });
  } });
  const task = run(["-b", "tree"], {}, { fs, signal: controller.signal, registerCleanup(callback) { cleanup = callback; } });
  await admitted; controller.abort(reason);
  await assert.rejects(task, error => error === reason);
  await cleanup!(); await cleanup!();
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  rejectHost(new Error("late host failure")); await turn();
});

test("registered cleanup closes admission without awaiting an opaque host promise", async () => {
  const base = createMemoryFileSystem();
  let cleanup: InvocationCleanup | undefined, entered!: () => void;
  const admitted = new Promise<void>(resolve => { entered = resolve; });
  const fs = wrapped(base, { async lstat() { entered(); return new Promise(() => {}); } });
  const task = run(["-b"], {}, { fs, registerCleanup(callback) { cleanup = callback; } });
  await admitted; await cleanup!();
  await assert.rejects(task, /invocation closed/u);
  await cleanup!();
});

test("overlapping cleanup shares completion and drains its own blocked-output cancellation", async () => {
  const fs = createMemoryFileSystem(); await seed(fs);
  const controller = new AbortController();
  let cleanup: InvocationCleanup | undefined, entered!: () => void;
  const admitted = new Promise<void>(resolve => { entered = resolve; });
  const task = run(["-b", "tree/a"], {}, { fs, signal: controller.signal, registerCleanup(callback) { cleanup = callback; }, stdout: { async write() { entered(); return new Promise(() => {}); } } });
  await admitted;
  const first = cleanup!(); const second = cleanup!(); assert.equal(first, second);
  await Promise.all([first, second]);
  await assert.rejects(task, /invocation closed/u);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("awaited stdout backpressure prevents traversal from advancing", async () => {
  const base = createMemoryFileSystem(); await seed(base); const checked = trace(base);
  let release!: () => void, entered!: () => void, writes = 0;
  const firstWrite = new Promise<void>(resolve => { entered = resolve; });
  const task = run(["-ba", "tree"], {}, { fs: checked.fs, stdout: { async write() {
    if (++writes === 1) { entered(); await new Promise<void>(resolve => { release = resolve; }); }
  } } });
  await firstWrite; const count = checked.calls.length; await turn();
  assert.equal(checked.calls.length, count);
  assert.ok(!checked.calls.some(call => call.path === "/tree/sub"));
  release(); assert.equal((await task).exitCode, 0);
});

test("sink cancellation and repeated finally/registered cleanup release listeners", async () => {
  const fs = createMemoryFileSystem(); await seed(fs);
  const controller = new AbortController(); const reason = Symbol("cancel sink");
  let cleanup: InvocationCleanup | undefined, entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const task = run(["-b", "tree/a"], {}, { fs, signal: controller.signal, registerCleanup(callback) { cleanup = callback; }, stdout: { async write() { entered(); return new Promise(() => {}); } } });
  await started; controller.abort(reason); await assert.rejects(task, error => error === reason);
  await cleanup!(); assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("sufficient traversal yields allow timer-driven cancellation", async () => {
  const fs = createMemoryFileSystem();
  for (let index = 0; index < 200; index++) await fs.writeFile(`/file-${index}`, new Uint8Array(1));
  const controller = new AbortController(); const reason = new Error("timer abort");
  const timer = setImmediate(() => controller.abort(reason));
  try { await assert.rejects(run(["-bs"], {}, { fs, signal: controller.signal }), error => error === reason); }
  finally { clearImmediate(timer); }
});

test("actual Shell caller abort preserves reason and stops later DU metadata admission", async () => {
  const base = createMemoryFileSystem(); await seed(base);
  const controller = new AbortController(); const reason = new FsError("ENOSPC");
  let entered!: () => void, calls = 0, rejectHost!: (error: unknown) => void;
  const admitted = new Promise<void>(resolve => { entered = resolve; });
  const fs = wrapped(base, { async lstat(_path, options) {
    calls++; assert.ok(options?.signal); entered();
    return new Promise((_resolve, reject) => { rejectHost = reject; });
  } });
  const shell = new Shell({ fs }).use(duCommands());
  try {
    const execution = shell.exec("du -bs tree", { signal: controller.signal });
    await admitted; controller.abort(reason);
    await assert.rejects(execution, error => error === reason);
    assert.equal(calls, 1); rejectHost(new Error("late public-boundary host failure")); await turn();
  } finally { await shell.dispose(); }
});
