import assert from "node:assert/strict";
import test from "node:test";
import { FsError } from "../../../src/contracts/index.js";
import { WalkBudget } from "../../../src/commands/tree/io.js";
import { settings, type TreeLimits } from "../../../src/commands/tree/options.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createMountFileSystem } from "../../../src/fs/mount/index.js";
import { run, shellRun, wrapped } from "./helpers.js";

async function measuredSteps(operation: () => Promise<void>): Promise<number> {
  const original = WalkBudget.prototype.step;
  let steps = 0;
  WalkBudget.prototype.step = function (count = 1) { steps += count; original.call(this, count); };
  try { await operation(); return steps; }
  finally { WalkBudget.prototype.step = original; }
}

async function measuredScans(value: string, operation: () => Promise<void>) {
  const replace = String.prototype.replace, byteLength = Buffer.byteLength, encode = TextEncoder.prototype.encode;
  const scans = { replace: 0, byteLength: 0, encode: 0 };
  String.prototype.replace = function (this: string, ...args: Parameters<typeof replace>) {
    if (this === value) scans.replace++;
    return Reflect.apply(replace, this, args) as string;
  } as typeof replace;
  Buffer.byteLength = function (...args: Parameters<typeof byteLength>) {
    if (args[0] === value) scans.byteLength++;
    return Reflect.apply(byteLength, Buffer, args) as number;
  };
  TextEncoder.prototype.encode = function (input?: string) {
    if (input === value) scans.encode++;
    return Reflect.apply(encode, this, [input]) as Uint8Array<ArrayBuffer>;
  };
  try { await operation(); return scans; }
  finally { String.prototype.replace = replace; Buffer.byteLength = byteLength; TextEncoder.prototype.encode = encode; }
}

function textBudget(limits: Partial<TreeLimits>): WalkBudget {
  return new WalkBudget({ command: "tree", args: [], cwd: "/", env: {}, fs: createMemoryFileSystem(),
    signal: new AbortController().signal, stdin: (async function* () {})(),
    stdout: { async write() {} }, stderr: { async write() {} } }, settings({ limits }));
}

test("TREE-WORK-002: actual Shell meters many long-prefix byte comparisons", async () => {
  const fs = createMemoryFileSystem();
  for (let index = 0; index < 32; index++) await fs.writeFile(`/${"x".repeat(62)}${String(index).padStart(2, "0")}`, new Uint8Array());
  const result = await shellRun(fs, ["-i", "--noreport"], { limits: { maxSteps: 256 } });
  console.log(JSON.stringify({ entries: 32, nameBytes: 64, commonPrefixBytes: 62,
    maxSteps: 256, exitCode: result.exitCode, stdoutBytes: result.stdoutBytes.length, stderr: result.stderr }));
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /tree work limit exceeded \(256\)/u);
});

test("TREE-WORK-002: dirsfirst consumes work beyond the first sorting pass", async () => {
  const fs = createMemoryFileSystem();
  for (let index = 0; index < 32; index++) {
    const path = `/${String(index).padStart(2, "0")}`;
    if (index % 2) await fs.mkdir(path); else await fs.writeFile(path, new Uint8Array());
  }
  const args = ["-L1", "--noreport"];
  const plainSteps = await measuredSteps(async () => assert.equal((await shellRun(fs, args)).exitCode, 0));
  assert.equal((await shellRun(fs, args, { limits: { maxSteps: plainSteps } })).exitCode, 0);
  const result = await shellRun(fs, [...args, "--dirsfirst"], { limits: { maxSteps: plainSteps } });
  console.log(JSON.stringify({ entries: 32, nameBytes: 2, plainSteps, dirsfirstExitCode: result.exitCode, stderr: result.stderr }));
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /tree work limit exceeded/u);
});

test("TEXT-BOUND-001: oversized public filesystem error is admitted before regex or byte scanning", async () => {
  const failure = new FsError("EIO", { message: "X".repeat(96) });
  const fs = wrapped(createMemoryFileSystem(), { async lstat() { throw failure; } });
  const errors: unknown[] = [];
  const scans = await measuredScans(failure.message, async () => {
    await assert.rejects(run([], { limits: { maxPathBytes: 32 } }, { fs, onInternalError(error) { errors.push(error); } }), /path\/name limit exceeded/u);
  });
  console.log(JSON.stringify({ messageCodeUnits: failure.message.length, maxPathBytes: 32, measuredRawMessageScans: scans }));
  assert.deepEqual(scans, { replace: 0, byteLength: 0, encode: 0 });
  assert.deepEqual(errors, []);
});

test("TEXT-BOUND-001: prefix stripping cannot evade raw backend message admission", async () => {
  const failure = new FsError("EACCES", { message: `${"A".repeat(96)}: denied` });
  const fs = wrapped(createMemoryFileSystem(), { async lstat() { throw failure; } });
  const result = await shellRun(fs, ["--noreport"], { limits: { maxPathBytes: 32 } });
  console.log(JSON.stringify({ rawMessageCodeUnits: failure.message.length, maxPathBytes: 32, exitCode: result.exitCode,
    stdout: result.stdout, stderr: result.stderr }));
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /path\/name limit exceeded/u);
});

test("byte comparison reservation fails before calling Buffer.compare", async () => {
  const fs = createMemoryFileSystem();
  for (let index = 0; index < 32; index++) await fs.writeFile(`/${"x".repeat(62)}${String(index).padStart(2, "0")}`, new Uint8Array());
  const original = Buffer.compare;
  let comparisons = 0;
  Buffer.compare = function (left, right) {
    if (left.length === 64 && right.length === 64) comparisons++;
    return original(left, right);
  };
  try {
    await assert.rejects(run(["--noreport"], { limits: { maxSteps: 100 } }, { fs }), /work limit exceeded/u);
    assert.equal(comparisons, 0);
    console.log(JSON.stringify({ nameBytes: 64, maxSteps: 100, measuredByteComparisons: comparisons }));
  } finally { Buffer.compare = original; }
});

test("dirsfirst checks cancellation before the next comparator evaluation", async () => {
  const fs = createMemoryFileSystem();
  for (let index = 0; index < 16; index++) {
    const path = `/${String(index).padStart(2, "0")}`;
    if (index % 2) await fs.mkdir(path); else await fs.writeFile(path, new Uint8Array());
  }
  const controller = new AbortController(), reason = new Error("abort dirsfirst comparison");
  const original = Array.prototype.sort;
  let completed = 0;
  Array.prototype.sort = function (compare) {
    if (!compare || !this[0] || typeof this[0].path !== "string") return original.call(this, compare);
    return original.call(this, (left, right) => {
      const order = compare(left, right);
      completed++;
      if (completed === 1) controller.abort(reason);
      return order;
    });
  };
  try {
    await assert.rejects(run(["-L1", "--dirsfirst"], {}, { fs, signal: controller.signal }), error => error === reason);
    assert.equal(completed, 1);
  } finally { Array.prototype.sort = original; }
});

test("remaining metadata is checked before scans; bounded UTF-8 sizing remains exact", async () => {
  const budget = textBudget({ maxPathBytes: 128, maxMetadataBytes: 32 });
  budget.text("a".repeat(20));
  const next = "b".repeat(20);
  assert.deepEqual(await measuredScans(next, async () => assert.throws(() => budget.text(next), /metadata limit/u)),
    { replace: 0, byteLength: 0, encode: 0 });
  const unicode = "雪".repeat(20);
  const limited = textBudget({ maxPathBytes: 32 });
  assert.deepEqual(await measuredScans(unicode, async () => assert.throws(() => limited.text(unicode), /path\/name limit/u)),
    { replace: 0, byteLength: 1, encode: 0 });
});

test("raw argument and sink text use constant-time lower bounds before byte sizing", async () => {
  const text = "z".repeat(96);
  assert.deepEqual(await measuredScans(text, async () => {
    await assert.rejects(run([text], { limits: { maxArgumentBytes: 32 } }), /argument limit/u);
  }), { replace: 0, byteLength: 0, encode: 0 });
  const output = textBudget({ maxOutputBytes: 32 });
  assert.deepEqual(await measuredScans(text, async () => {
    await assert.rejects(output.emit({ async write() { assert.fail("oversized sink write"); } }, text), /output limit/u);
  }), { replace: 0, byteLength: 0, encode: 0 });
});

test("opaque non-Error exceptions do not invoke arbitrary text coercion", async () => {
  let coercions = 0;
  const opaque = { toString() { coercions++; throw new Error("unexpected backend coercion"); } };
  const fs = wrapped(createMemoryFileSystem(), { async lstat() { throw opaque; } });
  const errors: unknown[] = [];
  const result = await run([], {}, { fs, onInternalError(error) { errors.push(error); } });
  assert.equal(result.exitCode, 1);
  assert.equal(coercions, 0);
  assert.equal(result.stderr, "tree: .: internal error\n");
  assert.equal(errors.length, 1);
  assert.equal(errors[0], opaque);
});

test("opaque backend Error text is not scanned or charged as public diagnostic text", async () => {
  const text = "X".repeat(96);
  const failure = new Error(text);
  const errors: unknown[] = [];
  const fs = wrapped(createMemoryFileSystem(), { async lstat() { throw failure; } });
  const scans = await measuredScans(text, async () => {
    const result = await run(["--noreport"], { limits: { maxPathBytes: 32 } }, {
      fs, onInternalError(error) { errors.push(error); },
    });
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, ".  [internal error]\n");
    assert.equal(result.stderr, "tree: .: internal error\n");
  });
  assert.deepEqual(scans, { replace: 0, byteLength: 0, encode: 0 });
  assert.equal(errors.length, 1);
  assert.equal(errors[0], failure);
});

test("control-heavy text and JSON honor exact completed-output bounds", async () => {
  const fs = createMemoryFileSystem();
  const name = `${"\u001b".repeat(8)}\u202e雪`;
  await fs.writeFile(`/${name}`, new Uint8Array());
  const mounted = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/fixture": fs } });
  for (const args of [["-i", "--noreport"], ["-Ji", "--noreport"], ["-J", "--noreport"]]) {
    const baseline = await shellRun(mounted, args, {}, "/fixture");
    const bytes = baseline.stdoutBytes.length;
    assert.equal(baseline.exitCode, 0);
    assert.doesNotMatch(baseline.stdout, /[\u001b\u202e]/u);
    const exact = await shellRun(mounted, args, { limits: { maxOutputBytes: bytes } }, "/fixture");
    assert.equal(exact.exitCode, 0, exact.stderr);
    assert.equal(exact.stdout, baseline.stdout);
    await assert.rejects(run(args, { limits: { maxOutputBytes: bytes - 1 } }, { fs: mounted, cwd: "/fixture" }), /output limit/u);
  }
  const original = JSON.stringify;
  let serializations = 0;
  JSON.stringify = function (...args: Parameters<typeof original>) {
    if (args[0] && typeof args[0] === "object" && args[0].name === name) serializations++;
    return Reflect.apply(original, JSON, args) as string;
  } as typeof original;
  try {
    await assert.rejects(run(["-Ji", "--noreport"], { limits: { maxOutputBytes: 80 } }, { fs }), /output limit/u);
    assert.equal(serializations, 0);
  } finally { JSON.stringify = original; }
});

test("control-heavy backend diagnostics fail admission without writing oversized fragments", async () => {
  const fs = wrapped(createMemoryFileSystem(), { async lstat() { throw new FsError("EACCES", { message: `EACCES: ${"\u001b".repeat(16)}` }); } });
  let writes = 0;
  await assert.rejects(run([], { limits: { maxOutputBytes: 32 } }, { fs, stderr: { async write() { writes++; } } }), /output limit/u);
  assert.equal(writes, 0);
  const result = await shellRun(fs, [], { limits: { maxOutputBytes: 32 } });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.doesNotMatch(result.stderr, /\u001b/u);
  assert.match(result.stderr, /tree output limit exceeded/u);
});

test("prior empty-alternative quota remains cumulative after accounting for sorting", async () => {
  const fs = createMemoryFileSystem();
  for (let index = 0; index < 32; index++) await fs.writeFile(`/${String(index).padStart(32, "x")}`, new Uint8Array());
  const plainSteps = await measuredSteps(async () => assert.equal((await shellRun(fs, ["--noreport"])).exitCode, 0));
  const maxSteps = plainSteps + 256;
  assert.equal((await shellRun(fs, ["--noreport"], { limits: { maxSteps } })).exitCode, 0);
  const result = await shellRun(fs, ["-P", "|".repeat(15), "--noreport"], { limits: { maxSteps } });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /work limit exceeded/u);
});
