import assert from "node:assert/strict";
import { setImmediate, setTimeout } from "node:timers/promises";
import test from "node:test";
import { CommandRegistry, FsError, type ByteSource } from "../../../../src/contracts/index.js";
import { createEncodingCommands } from "../../../../src/commands/bytes/encoding/index.js";
import { MemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { Shell } from "../../../../src/shell/index.js";
import { allBytes, countingSink, run, sliced, withStream } from "./helpers.js";

const commands = ["base64", "base32", "xxd", "od"] as const;

for (const name of commands) {
  test(`${name}: VFS streaming with signal and no readFile fallback`, async () => {
    const controller = new AbortController();
    const fs = withStream(sliced(allBytes, 3), (path, signal) => {
      assert.equal(path, "/work/file");
      assert.equal(signal, controller.signal);
    });
    const actual = await run(name, ["file"], "", { fs, cwd: "/work", signal: controller.signal });
    assert.equal(actual.exitCode, 0, actual.stderr);
    assert.deepEqual(actual.bytes, (await run(name, [], allBytes)).bytes);
  });

  test(`${name}: unsupported streaming capability and VFS errors stay explicit`, async () => {
    const fs = new MemoryFileSystem();
    Object.defineProperty(fs, "readStream", { value: undefined });
    assert.match((await run(name, ["file"], "", { fs })).stderr, /ENOTSUP.*streaming-read/u);
    assert.match((await run(name, ["missing"])).stderr, /ENOENT.*missing/u);
    const denied = withStream({ async *[Symbol.asyncIterator]() { throw new FsError("EACCES", { path: "/denied" }); } });
    const result = await run(name, ["denied"], "", { fs: denied });
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /EACCES.*denied/u);
  });

  test(`${name}: huge single chunk stays bounded and awaits every write`, async () => {
    const input = new Uint8Array(1024 * 1024 + 7).fill(173);
    const sink = countingSink();
    let busy = false;
    const result = await run(name, name === "od" ? ["-v", "-w4096", "-tx1"] : [], input, {
      stdout: { async write(chunk) {
        assert.equal(busy, false);
        busy = true;
        await setImmediate();
        await sink.write(chunk);
        busy = false;
      } },
    });
    assert.equal(result.exitCode, 0, result.stderr);
    assert(sink.size > input.length);
    assert(sink.writes > 1);
    assert(sink.largest <= 32768, String(sink.largest));
  });

  test(`${name}: blocked source cancellation propagates exact reason`, async () => {
    const controller = new AbortController();
    const reason = new Error("stop blocked source");
    let started!: () => void;
    const reading = new Promise<void>(resolve => { started = resolve; });
    const source: ByteSource = { [Symbol.asyncIterator]() { return {
      next() { started(); return new Promise(() => {}); },
      return() { return new Promise(() => {}); },
    }; } };
    const pending = run(name, [], source, { signal: controller.signal });
    await reading;
    controller.abort(reason);
    await assert.rejects(pending, error => error === reason);
  });

  test(`${name}: blocked sink cancellation and late rejection are observed`, async () => {
    const controller = new AbortController();
    const reason = new Error("stop blocked sink");
    let started!: () => void;
    let rejectWrite!: (reason: Error) => void;
    const writing = new Promise<void>(resolve => { started = resolve; });
    const pending = run(name, [], new Uint8Array(8192), {
      signal: controller.signal,
      stdout: { write() { started(); return new Promise<void>((_, reject) => { rejectWrite = reject; }); } },
    });
    await writing;
    controller.abort(reason);
    await assert.rejects(pending, error => error === reason);
    rejectWrite(new Error("late sink failure"));
    await setImmediate();
  });

  test(`${name}: timer cancels CPU work on a huge single chunk`, async () => {
    const controller = new AbortController();
    const reason = new Error("CPU cancellation");
    const sink = countingSink();
    const pending = run(name, name === "od" ? ["-v"] : [], new Uint8Array(16 * 1024 * 1024), { signal: controller.signal, stdout: sink });
    await setTimeout(5);
    controller.abort(reason);
    await assert.rejects(pending, error => error === reason);
    assert(sink.size < 16 * 1024 * 1024);
  });

  test(`${name}: downstream write errors are not hidden`, async () => {
    const result = await run(name, [], allBytes, { stdout: { async write() { throw new FsError("EPIPE"); } } });
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /EPIPE/u);
  });
}

test("streaming: producer cannot read ahead through blocked stdout", async () => {
  let requested = 0;
  let unblock!: () => void;
  let started!: () => void;
  const writing = new Promise<void>(resolve => { started = resolve; });
  const source: ByteSource = { async *[Symbol.asyncIterator]() {
    requested++; yield new Uint8Array(8192);
    requested++; yield new Uint8Array(8192);
  } };
  let first = true;
  const pending = run("base64", [], source, { stdout: { async write() {
    if (!first) return;
    first = false;
    started();
    await new Promise<void>(resolve => { unblock = resolve; });
  } } });
  await writing;
  await setImmediate();
  assert.equal(requested, 1);
  unblock();
  assert.equal((await pending).exitCode, 0);
  assert.equal(requested, 2);
});

test("streaming: ignore-only and empty chunks remain cancellable", async () => {
  for (const source of [
    { async *[Symbol.asyncIterator]() { yield new Uint8Array(8 * 1024 * 1024).fill(33); } },
    { async *[Symbol.asyncIterator]() { while (true) yield new Uint8Array(); } },
  ]) {
    const controller = new AbortController();
    const pending = run("base64", ["-di"], source, { signal: controller.signal });
    await setTimeout(5);
    controller.abort(new Error("stop empty work"));
    await assert.rejects(pending, /stop empty work/u);
  }
});

test("streaming: limit closes sources and repeated stdin does not replay", async () => {
  let closed = false;
  const source: ByteSource = { async *[Symbol.asyncIterator]() {
    try { yield Uint8Array.of(1, 2, 3); throw new Error("read past count"); }
    finally { closed = true; }
  } };
  assert.equal((await run("od", ["-An", "-tx1", "-N1"], source)).stdout, " 01\n");
  assert.equal(closed, true);
  assert.equal((await run("od", ["-An", "-tx1", "-", "-"], Uint8Array.of(1))).stdout, " 01\n");
  const neverRead: ByteSource = { async *[Symbol.asyncIterator]() { throw new Error("zero count must not pull"); } };
  assert.equal((await run("xxd", ["-l0"], neverRead)).exitCode, 0);
  assert.equal((await run("od", ["-N0"], neverRead)).exitCode, 0);
});

test("shell: manually registered binary pipelines and VFS inputs", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/binary", allBytes);
  const shell = new Shell({ fs, commands: new CommandRegistry(createEncodingCommands()) });
  for (const command of ["base64 binary | base64 -d", "base32 binary | base32 -d", "xxd binary | xxd -r", "xxd -p binary | xxd -rp", "base64 binary | base64 -d | base32 | base32 -d | xxd -p | xxd -rp"]) {
    const result = await shell.exec(command);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.stdoutBytes, allBytes, command);
  }
  const result = await shell.exec("base64 binary | base64 -d | od -An -tx1 -N4");
  assert.equal(result.stdout, " 00 01 02 03\n");
});

test("decoding: large single chunks have bounded writes and exact binary output", async () => {
  const input = new Uint8Array(256 * 1024 + 3).fill(253);
  for (const [name, encodeArgs, decodeArgs] of [
    ["base64", ["-w0"], ["-d"]], ["base32", ["-w0"], ["-d"]],
    ["xxd", ["-p", "-c0"], ["-rp"]], ["xxd", ["-c256"], ["-r", "-c256"]],
  ] as const) {
    const encoded = await run(name, encodeArgs, input);
    const sink = countingSink();
    const actual: Uint8Array[] = [];
    const result = await run(name, decodeArgs, encoded.bytes, { stdout: { async write(chunk) {
      await sink.write(chunk); actual.push(chunk.slice());
    } } });
    assert.equal(result.exitCode, 0, result.stderr);
    assert(sink.largest <= 32768);
    assert.deepEqual(Buffer.concat(actual), Buffer.from(input));
  }
});
