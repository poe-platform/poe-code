import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { FsError, type ByteSource } from "../../../../src/contracts/index.js";
import { chunks, encoder, fixture, overrideFs, run } from "./helpers.js";

const abcSha = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Value>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

for (const name of ["sha256sum", "sha1sum", "md5sum", "cksum"]) {
  test(`${name}: giant chunks match streaming partitions, including arbitrary bytes`, async () => {
    const bytes = Uint8Array.from({ length: 3 * 1024 * 1024 + 257 }, (_, index) => (index * 17 + (index >>> 8)) & 255);
    const whole = await run(name, [], { stdin: bytes });
    const partitioned = await run(name, [], { stdin: chunks(bytes, 8191) });
    assert.equal(whole.exitCode, 0);
    assert.deepEqual(partitioned, whole);
    if (name !== "cksum") assert.equal(whole.stdout, `${createHash(name.slice(0, -3)).update(bytes).digest("hex")}  -\n`);
  });

  test(`${name}: CPU work yields during a giant chunk and preserves abort reason`, async () => {
    const controller = new AbortController();
    const reason = new Error("stop giant chunk");
    const input = new Uint8Array(8 * 1024 * 1024);
    setImmediate(() => controller.abort(reason));
    await assert.rejects(run(name, [], { stdin: input, signal: controller.signal }), error => error === reason);
  });
}

test("blocked source cancellation returns promptly and observes late next/return rejections", { timeout: 2000 }, async () => {
  for (const args of [[], ["-c"]]) {
    const controller = new AbortController();
    const requested = deferred<void>();
    const next = deferred<IteratorResult<Uint8Array>>();
    const cleanup = deferred<IteratorResult<Uint8Array>>();
    let returned = false;
    const input: ByteSource = { [Symbol.asyncIterator]() { return {
      next() { requested.resolve(); return next.promise; },
      return() { returned = true; return cleanup.promise; },
    }; } };
    const reason = new Error("blocked source canceled");
    const running = run("sha256sum", args, { stdin: input, signal: controller.signal });
    await requested.promise;
    controller.abort(reason);
    await assert.rejects(running, error => error === reason);
    next.reject(new Error("late next rejection"));
    cleanup.reject(new Error("late cleanup rejection"));
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(returned, true);
  }
});

test("blocked stdout/stderr cancellation observes late sink rejection", { timeout: 2000 }, async () => {
  for (const target of ["stdout", "stderr"] as const) {
    const controller = new AbortController();
    const writing = deferred<void>();
    const blocked = deferred<void>();
    const sink = { write() { writing.resolve(); return blocked.promise; } };
    const reason = new Error(`blocked ${target} canceled`);
    const running = run("sha256sum", target === "stdout" ? [] : ["missing"], { [target]: sink, signal: controller.signal });
    await writing.promise;
    controller.abort(reason);
    await assert.rejects(running, error => error === reason);
    blocked.reject(new Error("late sink rejection"));
    await new Promise<void>(resolve => setImmediate(resolve));
  }
});

test("VFS stream receives signal; blocked file read can be canceled", { timeout: 2000 }, async () => {
  const fs = await fixture();
  const controller = new AbortController();
  const requested = deferred<void>();
  const read = deferred<IteratorResult<Uint8Array>>();
  const guarded = overrideFs(fs, { readStream(path, options) {
    assert.equal(path, "/work/data");
    assert.equal(options?.signal, controller.signal);
    assert.equal(options?.chunkSize, 65536);
    return { [Symbol.asyncIterator]() { return { next() { requested.resolve(); return read.promise; } }; } };
  } });
  const running = run("cksum", ["data"], { fs: guarded, signal: controller.signal });
  await requested.promise;
  controller.abort(new Error("stop VFS read"));
  await assert.rejects(running, /stop VFS read/u);
  read.reject(new Error("late VFS failure"));
  await new Promise<void>(resolve => setImmediate(resolve));
});

test("generation and verification await sink backpressure before opening next input", async () => {
  const fs = await fixture({ first: "abc", second: "abc" });
  for (const args of [["first", "second"], ["-c"]]) {
    const opened: string[] = [];
    const writing = deferred<void>();
    const blocked = deferred<void>();
    let writes = 0;
    const observed = overrideFs(fs, { readStream(path, options) { opened.push(path); return fs.readStream(path, options); } });
    const running = run("sha256sum", args, {
      fs: observed, stdin: `${abcSha}  first\n${abcSha}  second\n`,
      stdout: { async write() { writes++; if (writes === 1) { writing.resolve(); await blocked.promise; } } },
    });
    await writing.promise;
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual(opened, ["/work/first"]);
    blocked.resolve();
    assert.equal((await running).exitCode, 0);
    assert.deepEqual(opened, ["/work/first", "/work/second"]);
    assert.equal(writes, 2);
  }
});

test("manifest lines have a strict 64-KiB bound; next manifests still run", async () => {
  const fs = await fixture({ good: "abc", next: `${abcSha}  good\n` });
  for (const size of [1, 65535, 65536, 65537, 1024 * 1024]) {
    const overlong = encoder.encode("#".repeat(65537) + "\n");
    const result = await run("sha256sum", ["-c", "-", "next"], { fs, stdin: chunks(overlong, size) });
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /EFBIG.*65536/u);
    assert.equal(result.stdout, "good: OK\n");
  }
  const allowed = "#".repeat(65536) + `\n${abcSha}  good\n`;
  assert.equal((await run("sha256sum", ["-c", "--strict"], { fs, stdin: allowed })).exitCode, 0);
});

test("thousands of manifest entries stream without retaining prior records", async () => {
  const fs = await fixture({ good: "abc" });
  let emitted = 0;
  let checked = 0;
  const stdin = (async function* () {
    for (let index = 0; index < 4000; index++) {
      assert.equal(checked, emitted);
      emitted++;
      yield encoder.encode(`${abcSha}  good\n`);
    }
  })();
  const result = await run("sha256sum", ["-c"], { fs, stdin, stdout: { async write() { checked++; } } });
  assert.equal(result.exitCode, 0);
  assert.equal(checked, 4000);
});

test("empty-chunk floods yield and can be canceled", { timeout: 2000 }, async () => {
  const controller = new AbortController();
  const stdin = (async function* () { while (true) yield new Uint8Array(); })();
  setImmediate(() => controller.abort(new Error("empty flood")));
  await assert.rejects(run("sha256sum", [], { stdin, signal: controller.signal }), /empty flood/u);
});

test("read errors after matching records still fail and do not mutate VFS", async () => {
  const fs = await fixture({ good: "abc" });
  const stdin = (async function* () { yield encoder.encode(`${abcSha}  good\n`); throw new FsError("EIO"); })();
  const result = await run("sha256sum", ["-c"], { fs, stdin });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "good: OK\n");
  assert.match(result.stderr, /EIO/u);
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/good")), "abc");
});

test("pre-aborted commands do not access sources or sinks", async () => {
  const controller = new AbortController();
  const reason = new Error("already stopped");
  controller.abort(reason);
  const stdin: ByteSource = { [Symbol.asyncIterator]() { throw new Error("source accessed"); } };
  await assert.rejects(run("cksum", [], { stdin, signal: controller.signal, stdout: { async write() { throw new Error("sink accessed"); } } }), error => error === reason);
});

test("giant comment-only manifest chunks yield to cancellation", { timeout: 2000 }, async () => {
  const controller = new AbortController();
  const stdin = encoder.encode("# comment\n".repeat(250000));
  setImmediate(() => controller.abort(new Error("stop manifest scan")));
  await assert.rejects(run("sha256sum", ["-c"], { stdin, signal: controller.signal }), /stop manifest scan/u);
});

test("stdout failures are reported as failure rather than checksum success", async () => {
  const result = await run("sha256sum", [], { stdout: { async write() { throw new FsError("EPIPE"); } } });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /EPIPE/u);
});

test("checksum generation and verification invoke no VFS write methods", async () => {
  const fs = await fixture({ data: "abc", list: `${abcSha}  data\n` });
  const guarded = new Proxy(fs, {
    get(target, key) {
      if (["readStream", "capabilities"].includes(String(key))) {
        const value: unknown = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      }
      return () => { throw new Error(`unexpected VFS call: ${String(key)}`); };
    },
  });
  assert.equal((await run("sha256sum", ["data"], { fs: guarded })).exitCode, 0);
  assert.equal((await run("sha256sum", ["-c", "list"], { fs: guarded })).exitCode, 0);
  assert.equal((await run("cksum", ["data"], { fs: guarded })).exitCode, 0);
});

test("ignore-missing does not hide ENOENT after data has already been read", async () => {
  const fs = await fixture({ good: "abc" });
  const observed = overrideFs(fs, { async *readStream(path, options) {
    if (path === "/work/vanished") { yield Uint8Array.of(1); throw new FsError("ENOENT"); }
    yield* fs.readStream(path, options);
  } });
  const result = await run("sha256sum", ["-c", "--ignore-missing"], {
    fs: observed, stdin: `${abcSha}  vanished\n${abcSha}  good\n`,
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "vanished: FAILED open or read\ngood: OK\n");
  assert.match(result.stderr, /ENOENT/u);
  assert.match(result.stderr, /1 listed file\(s\) could not be read/u);
});

test("ignore-missing skips pre-data file ENOENT but never stdin read errors", async () => {
  const fs = await fixture({ good: "abc", list: `${abcSha}  -\n${abcSha}  good\n` });
  const observed = overrideFs(fs, { async *readStream(path, options) {
    if (path === "/work/missing") { yield new Uint8Array(); throw new FsError("ENOENT"); }
    yield* fs.readStream(path, options);
  } });
  const missing = await run("sha256sum", ["-c", "--ignore-missing"], {
    fs: observed, stdin: `${abcSha}  missing\n${abcSha}  good\n`,
  });
  assert.deepEqual(missing, { exitCode: 0, stdout: "good: OK\n", stderr: "" });
  const stdin = (async function* () { yield new Uint8Array(); throw new FsError("ENOENT"); })();
  const failed = await run("sha256sum", ["-c", "--ignore-missing", "list"], { fs, stdin });
  assert.equal(failed.exitCode, 1);
  assert.equal(failed.stdout, "-: FAILED open or read\ngood: OK\n");
  assert.match(failed.stderr, /ENOENT/u);
});
