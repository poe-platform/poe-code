import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { setImmediate as yieldTurn } from "node:timers/promises";
import test from "node:test";
import { FsError, type FileStat, type FileSystem } from "../../../src/contracts/index.js";
import { treeCommands } from "../../../src/commands/tree/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell, ShellLimitError } from "../../../src/shell/index.js";
import { run, seed, wrapped } from "./helpers.js";

function deferred<Value>() {
  let resolve!: (value: Value) => void, reject!: (error: unknown) => void;
  const promise = new Promise<Value>((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}

const directoryStat: FileStat = { type: "directory", mode: 0o40755, size: 0, mtimeMs: 0, atimeMs: 0, ctimeMs: 0 };

test("known ancestor identity prevents recursion; bare inode and lexical realpath do not", async () => {
  const backing = createMemoryFileSystem();
  const scope = {};
  const cycle = wrapped(backing, {
    async lstat() { return { ...directoryStat, identityScope: scope, dev: 1, ino: 1 }; },
    async readdir() { return [{ name: "again", type: "directory" }]; },
  });
  const found = await run(["-l"], {}, { fs: cycle });
  assert.equal(found.exitCode, 0);
  assert.match(found.stdout, /again {2}\[recursive, not followed\]/u);
  let reads = 0;
  const unknown = wrapped(backing, {
    async lstat() { return { ...directoryStat, dev: 1, ino: 1 }; },
    async readdir() { reads++; return [{ name: "again", type: "directory" }]; },
    async realpath() { return "/"; }, compareEntry: undefined,
  });
  const output: Uint8Array[] = [];
  await assert.rejects(run(["-l"], { limits: { maxDepth: 4 } }, { fs: unknown,
    stdout: { async write(bytes) { output.push(bytes.slice()); } } }), /depth limit exceeded/u);
  assert.equal(reads, 4);
  assert.doesNotMatch(Buffer.concat(output).toString(), /recursive/u);
  const limited = await run(["-L2"], { limits: { maxDepth: 4 } }, { fs: unknown });
  assert.equal(limited.exitCode, 0);
});

test("distinct scopes are never equated by inode; compareEntry handles unknown authoritative aliases", async () => {
  const backing = createMemoryFileSystem();
  const scopes = { root: Symbol("same description"), child: Symbol("same description") };
  const distinct = wrapped(backing, {
    async lstat(path) { return { ...directoryStat, identityScope: path === "/" ? scopes.root : scopes.child, dev: 1, ino: 1 }; },
    async readdir(path) { return path === "/" ? [{ name: "child", type: "directory" }] : []; },
    async compareEntry() { throw new Error("complete identity must be sufficient"); },
  });
  const result = await run([], {}, { fs: distinct });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /recursive/u);
  const compared = wrapped(backing, {
    async lstat() { return directoryStat; },
    async readdir() { return [{ name: "alias", type: "directory" }]; },
    async compareEntry(_path, peer, _peerPath, options) {
      assert.equal(peer, compared); assert.ok(options?.signal); return "same";
    },
  });
  assert.match((await run([], {}, { fs: compared })).stdout, /recursive, not followed/u);
  const denied = wrapped(backing, {
    async lstat() { return directoryStat; }, async readdir() { return [{ name: "alias", type: "directory" }]; },
    async compareEntry() { throw new FsError("EACCES", { path: "/alias" }); },
  });
  const failure = await run([], {}, { fs: denied });
  assert.equal(failure.exitCode, 1); assert.match(failure.stderr, /permission denied/u);
  assert.doesNotMatch(failure.stdout, /recursive/u);
});

test("limits charge excluded entries, per-directory arrays, work, paths, metadata, arguments and bytes", async () => {
  const fs = createMemoryFileSystem(); await seed(fs);
  for (const [limits, args, expected] of [
    [{ maxEntries: 2 }, ["-I", "*"], /entry limit/u],
    [{ maxDirectoryEntries: 2 }, ["-I", "*"], /directory entry limit/u],
    [{ maxSteps: 1 }, [], /work limit/u],
    [{ maxPathBytes: 3 }, [], /path\/name limit/u],
    [{ maxMetadataBytes: 4 }, [], /metadata limit/u],
    [{ maxArgumentBytes: 3 }, ["long"], /argument limit/u],
    [{ maxArguments: 1 }, ["-a", "-d"], /argument count limit/u],
    [{ maxOutputBytes: 1 }, [], /output limit/u],
  ] as const) await assert.rejects(run(args, { limits }, { fs }), expected);
  await assert.rejects(run(["-P", "*a*a*a*a*a*a*a*a*a*b"], { limits: { maxSteps: 100 } }, { fs }), /work limit/u);
});

test("invalid adapter entry names and duplicates never resolve outside listed directory", async () => {
  for (const name of ["../outside", "x/y", "", "\0", "\ud800"]) {
    const fs = wrapped(createMemoryFileSystem(), { async readdir() { return [{ name, type: "file" }]; } });
    const result = await run([], {}, { fs });
    assert.equal(result.exitCode, 1); assert.match(result.stderr, /invalid or duplicate/u);
  }
  const fs = wrapped(createMemoryFileSystem(), { async readdir() { return [{ name: "same", type: "file" }, { name: "same", type: "file" }]; } });
  assert.equal((await run([], {}, { fs })).exitCode, 1);
});

test("stdout backpressure prevents advance; chunks remain owned; sink failures propagate exactly", async () => {
  const backing = createMemoryFileSystem(); await seed(backing);
  let operations = 0;
  const fs = wrapped(backing, { async readdir(path, options) { operations++; return backing.readdir(path, options); } });
  const started = deferred<void>(), held = deferred<void>();
  const chunks: Uint8Array[] = [];
  const result = run([], {}, { fs, stdout: { async write(bytes) {
    chunks.push(bytes);
    if (chunks.length === 1) { started.resolve(); await held.promise; }
  } } });
  await started.promise;
  const observedOperations = operations;
  await yieldTurn(); assert.equal(operations, observedOperations); assert.equal(chunks.length, 1);
  held.resolve(); assert.equal((await result).exitCode, 0);
  assert.equal(Buffer.from(chunks[0]!).toString(), ".\n");
  const failure = new Error("owned broken sink");
  await assert.rejects(run([], {}, { fs, stdout: { async write() { throw failure; } } }), error => error === failure);
  await assert.rejects(run(["missing"], {}, { fs, stderr: { async write() { throw failure; } } }), error => error === failure);
});

for (const operation of ["lstat", "readdir", "stat", "readlink", "compareEntry"] as const) {
  test(`cancellation around ${operation} observes late rejection and forwards exact signal`, async () => {
    const backing = createMemoryFileSystem(); await seed(backing);
    const controller = new AbortController();
    const reason = new FsError("ENOENT", { message: "errno-shaped abort must not be swallowed" });
    const started = deferred<void>(), held = deferred<never>();
    const overrides: Partial<FileSystem> = {};
    if (operation === "compareEntry") overrides.lstat = async () => directoryStat;
    Object.assign(overrides, { [operation]: async (...args: unknown[]) => {
      const options = args.at(-1) as { signal: AbortSignal };
      assert.equal(options.signal, controller.signal);
      started.resolve(); return held.promise;
    } });
    const fs = wrapped(backing, overrides);
    const result = run(["-l"], {}, { fs, signal: controller.signal });
    await started.promise; controller.abort(reason);
    await assert.rejects(result, error => error === reason);
    held.reject(new Error(`late ${operation} failure`));
    await yieldTurn();
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  });
}

test("pre-aborted invocation and abort during stdout produce no fallback diagnostic", async () => {
  const controller = new AbortController(), reason = new FsError("EACCES");
  controller.abort(reason);
  await assert.rejects(run([], {}, { signal: controller.signal }), error => error === reason);
  const active = new AbortController(), started = deferred<void>(), held = deferred<void>();
  let errors = 0;
  const result = run([], {}, { signal: active.signal, stdout: { async write() { started.resolve(); await held.promise; } },
    stderr: { async write() { errors++; } } });
  await started.promise; active.abort(reason);
  await assert.rejects(result, error => error === reason);
  held.reject(new Error("late sink failure")); await yieldTurn();
  assert.equal(errors, 0);
});

test("actual Shell charges output through shared sinks across two tree invocations", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(treeCommands());
  try {
    assert.equal((await shell.exec("tree --noreport", { limits: { maxOutputBytes: 2 } })).stdout, ".\n");
    await assert.rejects(shell.exec("tree --noreport; tree --noreport", { limits: { maxOutputBytes: 3 } }),
      error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
    await assert.rejects(shell.exec("tree missing", { limits: { maxOutputBytes: 1 } }),
      error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
  } finally { await shell.dispose(); }
});

test("actual Shell preserves errno-shaped abort while backend work rejects later", async () => {
  const backing = createMemoryFileSystem(), started = deferred<void>(), held = deferred<never>();
  const controller = new AbortController(), reason = new FsError("ENOENT");
  const fs = wrapped(backing, { async readdir(_path, options) {
    assert.ok(options?.signal); started.resolve(); return held.promise;
  } });
  const shell = new Shell({ fs }).use(treeCommands());
  try {
    const result = shell.exec("tree", { signal: controller.signal });
    await started.promise; controller.abort(reason);
    await assert.rejects(result, error => error === reason);
    held.reject(new Error("late backend rejection after shell abort")); await yieldTurn();
  } finally { await shell.dispose(); }
});

test("stdin and file content are unused, genuine ELOOP is an error, diagnostics are bounded", async () => {
  const backing = createMemoryFileSystem(); await backing.symlink!("loop", "/loop");
  const fs = wrapped(backing, { async readFile() { throw new Error("unexpected content read"); } });
  const result = await run(["-Ji"], {}, { fs, stdin: (async function* () { throw new Error("unexpected stdin read"); })() });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /too many symbolic links/u);
  assert.match(JSON.parse(result.stdout)[0].contents[0].error, /too many symbolic links/u);
  const hugeError = wrapped(backing, { async lstat() { throw new Error("x".repeat(1000)); } });
  await assert.rejects(run([], { limits: { maxPathBytes: 100 } }, { fs: hugeError }), /path\/name limit/u);
});
