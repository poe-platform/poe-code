import assert from "node:assert/strict";
import test from "node:test";
import { FsError, type EntryComparison, type FileStat, type FileSystem } from "../../src/contracts/index.js";
import { compareObservedEntries } from "../../src/commands/copy-identity.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";
import { fixture, run } from "./helpers.js";

const unknown: FileStat = { type: "file", size: 0, mode: 0o644, atimeMs: 0, mtimeMs: 0, ctimeMs: 0 };
const relations = ["same", "distinct", "unknown"] as const;

function proxy(base: FileSystem, methods: Partial<FileSystem>): FileSystem {
  return new Proxy(base, { get(target, key) {
    const owner = key in methods ? methods : target, value = Reflect.get(owner, key);
    return typeof value === "function" ? value.bind(owner) : value;
  } });
}

for (const left of relations) for (const right of relations) {
  test(`comparison negotiates each authority once: ${left}/${right}`, async () => {
    const calls: unknown[][] = [], controller = new AbortController();
    const source = proxy(createMemoryFileSystem(), { compareEntry: async (...args) => { calls.push(args); return left; } });
    const target = proxy(createMemoryFileSystem(), { compareEntry: async (...args) => { calls.push(args); return right; } });
    const result = compareObservedEntries(source, "/source", unknown, target, "/target", unknown, { signal: controller.signal });
    if (left !== "unknown" && right !== "unknown" && left !== right) await assert.rejects(result, { code: "EIO" });
    else assert.equal(await result, left === "unknown" ? right : left);
    assert.equal(calls.length, 2);
    assert.equal(calls[0]![1], target); assert.equal(calls[1]![1], source);
    assert.equal(calls[0]![0], "/source"); assert.equal(calls[1]![0], "/target");
    assert.equal((calls[0]![3] as { signal: AbortSignal }).signal, controller.signal);
  });
}

test("a shared authority is queried only once", async () => {
  let calls = 0;
  const fs = proxy(createMemoryFileSystem(), { compareEntry: async () => { calls++; return "distinct"; } });
  assert.equal(await compareObservedEntries(fs, "/one", unknown, fs, "/two", unknown), "distinct");
  assert.equal(calls, 1);
});

test("absent authority remains unknown rather than coerced distinct", async () => {
  const fs = new Proxy(createMemoryFileSystem(), { get(target, key) {
    if (key === "compareEntry") return undefined;
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  assert.equal(await compareObservedEntries(fs, "/one", unknown, fs, "/two", unknown), "unknown");
});

for (const invalid of [undefined, null, true, "DISTINCT", { toString() { throw new Error("never coerce"); } }]) {
  test(`invalid comparison literal ${typeof invalid} fails EIO`, async () => {
    const fs = proxy(createMemoryFileSystem(), { compareEntry: async () => invalid as EntryComparison });
    await assert.rejects(compareObservedEntries(fs, "/one", unknown, fs, "/two", unknown), { code: "EIO" });
  });
}

for (const code of ["ENOENT", "EACCES", "EIO"] as const) test(`comparison preserves ${code} rather than treating it as unknown`, async () => {
  const error = new FsError(code, { path: "/one" });
  const fs = proxy(createMemoryFileSystem(), { compareEntry: async () => { throw error; } });
  await assert.rejects(compareObservedEntries(fs, "/one", unknown, fs, "/two", unknown), actual => actual === error);
});

for (const reject of [false, true]) test(`abort prevents peer work after first authority, rejected=${reject}`, async () => {
  const controller = new AbortController(), reason = new Error("cancel authority"); let calls = 0;
  const source = proxy(createMemoryFileSystem(), { compareEntry: async () => {
    controller.abort(reason); if (reject) throw new FsError("ENOENT"); return "distinct";
  } });
  const target = proxy(createMemoryFileSystem(), { compareEntry: async () => { calls++; return "distinct"; } });
  await assert.rejects(compareObservedEntries(source, "/source", unknown, target, "/target", unknown, { signal: controller.signal }), error => error === reason);
  assert.equal(calls, 0);
});

test("complete identities do not query or allow an authority to override aliases", async () => {
  const scope = Symbol(), stat = { ...unknown, identityScope: scope, dev: 0, ino: 0 };
  const fs = proxy(createMemoryFileSystem(), { compareEntry: async () => { throw new Error("must not query"); } });
  assert.equal(await compareObservedEntries(fs, "/one", stat, fs, "/two", stat), "same");
  assert.equal(await compareObservedEntries(fs, "/one", stat, fs, "/two", { ...stat, ino: 1 }), "distinct");
});

async function uncertain(relation: EntryComparison, symlink = false) {
  const base = await fixture({ source: "source bytes", target: "old target" });
  if (symlink) await base.symlink("source", "/work/link");
  let copies = 0, removals = 0, comparisons = 0;
  const unscoped = async (path: string, follow: boolean): Promise<FileStat> => {
    const { identityScope: ignored, ...stat } = await base[follow ? "stat" : "lstat"](path); void ignored; return stat;
  };
  const fs = proxy(base, {
    stat: path => unscoped(path, true), lstat: path => unscoped(path, false),
    rename: async () => { throw new FsError("EXDEV"); },
    compareEntry: async () => { comparisons++; return relation; },
    copyFile: async (...args) => { copies++; await base.copyFile(...args); },
    rm: async (...args) => { removals++; await base.rm(...args); },
  });
  return { fs, base, effects: () => ({ copies, removals, comparisons }) };
}

for (const relation of relations) test(`cross-device move uses comparison ${relation} before copy/delete`, async () => {
  const { fs, base, effects } = await uncertain(relation);
  const result = await run("mv", ["source", "target"], { fs });
  assert.equal(result.exitCode, relation === "distinct" ? 0 : 1, result.stderr);
  assert.equal(effects().comparisons, 1);
  if (relation === "distinct") {
    assert.equal(effects().copies, 1); assert.equal(effects().removals, 1);
    await assert.rejects(base.stat("/work/source"), { code: "ENOENT" });
    assert.equal(Buffer.from(await base.readFile("/work/target")).toString(), "source bytes");
  } else {
    assert.equal(effects().copies, 0); assert.equal(effects().removals, 0);
    assert.equal(Buffer.from(await base.readFile("/work/source")).toString(), "source bytes");
    assert.equal(Buffer.from(await base.readFile("/work/target")).toString(), "old target");
  }
});

test("followed comparison never authorizes unlinking an unknown symlink entry", async () => {
  const { fs, base, effects } = await uncertain("distinct", true);
  const result = await run("mv", ["link", "target"], { fs });
  assert.equal(result.exitCode, 1); assert.match(result.stderr, /authoritative/u);
  assert.deepEqual(effects(), { copies: 0, removals: 0, comparisons: 0 });
  assert.equal(await base.readlink("/work/link"), "source");
});

test("cp rejects an authority-proven alias before native content work", async () => {
  const { fs, base, effects } = await uncertain("same");
  const result = await run("cp", ["source", "target"], { fs });
  assert.equal(result.exitCode, 1); assert.match(result.stderr, /same file/u);
  assert.equal(effects().copies, 0); assert.equal(effects().removals, 0);
  assert.equal(Buffer.from(await base.readFile("/work/source")).toString(), "source bytes");
});

test("cp -f accepts qualified distinct entries, then retries exclusively", async () => {
  const { fs, base } = await uncertain("distinct"); let copies = 0;
  const guarded = proxy(fs, { copyFile: async (...args) => {
    if (++copies === 1) throw new FsError("EACCES");
    assert.equal(args[2]?.exclusive, true); await base.copyFile(...args);
  } });
  const result = await run("cp", ["-f", "source", "target"], { fs: guarded });
  assert.equal(result.exitCode, 0, result.stderr); assert.equal(copies, 2);
  assert.equal(Buffer.from(await base.readFile("/work/source")).toString(), "source bytes");
  assert.equal(Buffer.from(await base.readFile("/work/target")).toString(), "source bytes");
});
