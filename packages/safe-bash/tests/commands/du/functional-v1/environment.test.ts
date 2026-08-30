import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { FsError, type InvocationCleanup } from "../../../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { metadata, run, seed, shellRun, trace } from "../helpers.js";
import { explicitDiagnostics, nativeCases, type NativeCase } from "./native-cases.js";

interface Observation extends NativeCase { readonly status: number; readonly stdout: string; readonly stderr: string }
const captured = JSON.parse(await readFile(new URL("native-observations.json", import.meta.url), "utf8")) as { results: Observation[] };
assert.deepEqual(captured.results.map(({ id, args, env }) => ({ id, args, env })), nativeCases);

for (const observation of captured.results) {
  test(`frozen GNU 9.7 functional regression ${observation.id}`, async () => {
    const fs = createMemoryFileSystem(); await fs.writeFile("/file", new Uint8Array(1025));
    const checked = trace(fs);
    const result = await shellRun(checked.fs, observation.args, { ...observation.env });
    assert.equal(result.exitCode, observation.status);
    assert.equal(result.stdout, observation.stdout);
    assert.equal(result.stderr, explicitDiagnostics[observation.id] ?? observation.stderr);
    if (observation.id.startsWith("explicit-invalid") || observation.id === "empty-only") assert.equal(checked.calls.length, 0);
    else assert.deepEqual(checked.calls.map(call => [call.method, call.path]), [["lstat", "/file"]]);
  });
}

const original = JSON.parse(await readFile(new URL("../native-profile.json", import.meta.url), "utf8")) as { results: Observation[] };
for (const index of [85, 86]) {
  test(`original frozen O${index + 1} now agrees without changing original bytes`, async () => {
    const observation = original.results[index]!;
    const fs = createMemoryFileSystem(); await fs.writeFile("/size-1025", new Uint8Array(1025));
    const result = await shellRun(fs, observation.args, { ...observation.env });
    assert.equal(result.exitCode, observation.status);
    assert.equal(result.stdout, observation.stdout); assert.equal(result.stderr, observation.stderr);
  });
}

test("selected environment fallback never reads lower-priority getters", async () => {
  const fs = createMemoryFileSystem(); await fs.writeFile("/file", new Uint8Array(1025));
  for (const selected of ["", "bad"]) {
    const env = Object.create(null) as Record<string, string>;
    Object.defineProperties(env, { DU_BLOCK_SIZE: { value: selected }, BLOCK_SIZE: { get() { throw new Error("lower priority must remain unread"); } }, BLOCKSIZE: { get() { throw new Error("lower priority must remain unread"); } } });
    assert.equal((await run(["--apparent-size", "file"], {}, { fs, env })).stdout, "2\tfile\n");
  }
});

test("inherited environment values and inherited POSIX flag do not change defaults", async () => {
  const fs = createMemoryFileSystem(); await fs.writeFile("/file", new Uint8Array(1025));
  const env = Object.create({ DU_BLOCK_SIZE: "1", POSIXLY_CORRECT: "" }) as Record<string, string>;
  assert.equal((await run(["--apparent-size", "file"], {}, { fs, env })).stdout, "2\tfile\n");
});

test("environment byte and work limits stay fatal, never formatting fallback", async () => {
  const checked = trace(createMemoryFileSystem());
  for (const limits of [{ maxArgumentBytes: 20 }, { maxSteps: 40 }]) {
    const result = await run(["--apparent-size", "file"], { limits }, { fs: checked.fs, env: { DU_BLOCK_SIZE: "x".repeat(100) } });
    assert.equal(result.exitCode, 1); assert.equal(result.stdout, ""); assert.match(result.stderr, /limit exceeded/u);
  }
  assert.equal(checked.calls.length, 0);
});

test("fallback retains unknown allocation rejection and does not use file length", async () => {
  const base = createMemoryFileSystem(); await base.writeFile("/file", new Uint8Array(1025));
  for (const fs of [base, metadata(base, stat => ({ ...stat, allocatedBytes: -1 }))]) {
    const result = await run(["file"], {}, { fs, env: { DU_BLOCK_SIZE: "bad" } });
    assert.equal(result.exitCode, 1); assert.equal(result.stdout, ""); assert.match(result.stderr, /allocated bytes (unknown|invalid)/u);
  }
  const zero = metadata(base, stat => ({ ...stat, allocatedBytes: 0 }));
  assert.equal((await run(["file"], {}, { fs: zero, env: { DU_BLOCK_SIZE: "" } })).stdout, "0\tfile\n");
});

test("fallback keeps output caps and exact cancellation reason", async () => {
  const fs = createMemoryFileSystem(); await fs.writeFile("/file", new Uint8Array(1025));
  const limited = await run(["--apparent-size", "file"], { limits: { maxOutputBytes: 2 } }, { fs, env: { DU_BLOCK_SIZE: "bad" } });
  assert.equal(limited.exitCode, 1); assert.ok(Buffer.byteLength(limited.stdout + limited.stderr) <= 2);
  const controller = new AbortController(); const reason = new FsError("EACCES"); controller.abort(reason);
  await assert.rejects(run(["--apparent-size", "file"], {}, { fs, env: { DU_BLOCK_SIZE: "bad" }, signal: controller.signal }), error => error === reason);
});

test("fallback keeps registered cleanup and awaited sink backpressure", async () => {
  const fs = createMemoryFileSystem(); await fs.writeFile("/file", new Uint8Array(1025));
  let cleanup: InvocationCleanup | undefined, entered!: () => void, release!: () => void, settled = false;
  const admitted = new Promise<void>(resolve => { entered = resolve; });
  const pending = run(["--apparent-size", "file"], {}, { fs, env: { DU_BLOCK_SIZE: "bad" }, registerCleanup(callback) { cleanup = callback; }, stdout: { async write() { assert.ok(cleanup); entered(); await new Promise<void>(resolve => { release = resolve; }); } } });
  void pending.then(() => { settled = true; });
  await Promise.race([admitted, pending.then(() => { throw new Error("command settled before its output write"); })]);
  await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(settled, false);
  release(); assert.equal((await pending).exitCode, 0); await cleanup!();
});

test("empty operand diagnoses invalid name without any empty/root lookup and preserves later errors", async () => {
  const fs = createMemoryFileSystem(); const checked = trace(fs);
  const result = await run(["-bc", "", "missing"], {}, { fs: checked.fs });
  assert.equal(result.exitCode, 1); assert.equal(result.stdout, "");
  assert.equal(result.stderr, "du: invalid zero-length file name\ndu: \"missing\": no such file or directory, lstat '/missing'\n");
  assert.deepEqual(checked.calls.map(call => call.path), ["/missing"]);
});

test("O060 repeated-directory behavior and deterministic ordering stay unchanged", async () => {
  const fs = createMemoryFileSystem(); await seed(fs);
  const result = await shellRun(fs, ["-b", "tree", "tree"]);
  assert.equal(result.exitCode, 0); assert.equal(result.stdout, "5\ttree/sub\n8\ttree\n0\ttree/sub\n0\ttree\n");
  await fs.writeFile("/tree/z", new Uint8Array(1)); await fs.writeFile("/tree/c", new Uint8Array(1));
  const sorted = await shellRun(fs, ["-ba", "tree"]);
  assert.ok(sorted.stdout.indexOf("\ttree/a\n") < sorted.stdout.indexOf("\ttree/c\n"));
  assert.ok(sorted.stdout.indexOf("\ttree/c\n") < sorted.stdout.indexOf("\ttree/z\n"));
});
