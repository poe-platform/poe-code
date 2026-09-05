import assert from "node:assert/strict";
import test from "node:test";
import { createFsFromVolume, Volume } from "memfs";
import { FsError, createMemoryFileSystem } from "poe-code/safe-fs";
import type { DdFileHandle, DdFileOpener, DdFileRequest } from "../../../src/commands/dd/io.js";
import { openDdFile } from "../../../src/commands/dd/io.js";
import { bytes, run } from "./helpers.js";

function fixture(initial: Record<string, string>) {
  const fs = createFsFromVolume(Volume.fromJSON(initial));
  const requests: DdFileRequest[] = [];
  const writes: number[] = [];
  const synchronizations: boolean[] = [];
  let closed = 0;
  const openFile: DdFileOpener = async (context, request) => {
    requests.push(request);
    if (request.path === undefined) return openDdFile(context, request);
    const path = request.path;
    const flag = request.direction === "input" ? "r" : request.creation === "exclusive" ? "wx+"
      : request.creation === "never" ? "r+" : request.truncate ? "w+" : fs.existsSync(path) ? "r+" : "w+";
    const descriptor = fs.openSync(path, flag);
    let position = 0;
    let ended = false;
    if (request.direction === "output" && request.truncate && request.creation === "never") fs.ftruncateSync(descriptor, 0);
    return {
      type: "file", size: BigInt(fs.fstatSync(descriptor).size),
      async read(size) {
        const buffer = new Uint8Array(size);
        const count = fs.readSync(descriptor, buffer, 0, size, position);
        position += count;
        return buffer.subarray(0, count);
      },
      async write(chunk) {
        writes.push(chunk.length);
        if (request.flags.has("append")) position = fs.fstatSync(descriptor).size;
        const count = fs.writeSync(descriptor, chunk, 0, chunk.length, position);
        position += count;
        return count;
      },
      async seek(offset) { position = Number(offset); },
      async getPosition() { return BigInt(position); },
      async getSize() { return BigInt(fs.fstatSync(descriptor).size); },
      async truncate(length) { fs.ftruncateSync(descriptor, Number(length)); },
      async sync(dataOnly) { synchronizations.push(dataOnly); },
      async close() { if (!ended) { ended = true; fs.closeSync(descriptor); closed++; } },
    };
  };
  return { fs, openFile, requests, writes, synchronizations, closed: () => closed };
}

test("positioned handle writes preserve prefixes/tails and default seek truncates", async () => {
  for (const [args, expected] of [
    [["bs=2", "seek=2", "count=1"], "abcdXY"],
    [["bs=2", "seek=2", "count=1", "conv=notrunc"], "abcdXYgh"],
    [["bs=2", "oseek=3B", "count=1", "conv=notrunc"], "abcXYfgh"],
    [["bs=2", "seek=3", "oflag=seek_bytes", "count=1", "conv=notrunc"], "abcXYfgh"],
    [["bs=2", "seek=2", "count=0"], "abcd"],
    [["bs=2", "seek=5", "count=0"], "abcdefgh\0\0"],
    [["bs=2", "count=1", "oflag=append", "conv=notrunc"], "abcdefghXY"],
    [["bs=2", "count=1", "oflag=append"], "XY"],
  ] as const) {
    const fixtureFs = fixture({ "/output": "abcdefgh" });
    const result = await run(["of=/output", "status=noxfer", ...args], bytes("XYZ"), {}, { openFile: fixtureFs.openFile });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(new Uint8Array(fixtureFs.fs.readFileSync("/output") as Buffer), bytes(expected));
    assert.equal(fixtureFs.closed(), 1);
  }
});

test("sparse handle output skips zero blocks and extends final holes without shortening tails", async () => {
  for (const notrunc of [false, true]) {
    const fixtureFs = fixture({ "/output": "abcdefgh" });
    const result = await run(["of=/output", "bs=2", "status=noxfer", `conv=sparse${notrunc ? ",notrunc" : ""}`], new Uint8Array([88, 89, 0, 0]), {}, { openFile: fixtureFs.openFile });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(new Uint8Array(fixtureFs.fs.readFileSync("/output") as Buffer), bytes(notrunc ? "XYcdefgh" : "XY\0\0"));
    assert.deepEqual(fixtureFs.writes, [2]);
    assert.equal(result.stderr, "2+0 records in\n2+0 records out\n");
  }
});

test("sparse output does not discard trailing zeros without a truthful extension capability", async () => {
  for (const metadata of [{}, { type: "file", size: 0n }]) {
    const accepted: Uint8Array[] = [];
    let seeks = 0;
    const openFile: DdFileOpener = async (context, request) => request.direction === "input" ? openDdFile(context, request) : {
      ...metadata,
      async write(chunk) { accepted.push(new Uint8Array(chunk)); return chunk.length; },
      async seek() { seeks++; },
      async close() {},
    };
    const result = await run(["conv=sparse", "bs=2", "status=none"], new Uint8Array(4), {}, { openFile });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(new Uint8Array(Buffer.concat(accepted)), new Uint8Array(4));
    assert.equal(seeks, 0);
  }
});

for (const input of ["XY\0\0", "\0\0XY\0\0"]) {
  test(`sparse append uses an injected retained cursor after data writes: ${JSON.stringify(input)}`, async () => {
    const fixtureFs = fixture({ "/output": "abcdef" });
    const result = await run(["of=/output", "bs=2", "seek=1", "oflag=append", "conv=notrunc,sparse", "status=none"], bytes(input), {}, { openFile: fixtureFs.openFile });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(new Uint8Array(fixtureFs.fs.readFileSync("/output") as Buffer), bytes("abcdefXY\0\0"));
    assert.deepEqual(fixtureFs.writes, [2]);
  });
}

for (const replacement of ["abcdefXYuvw", "abc"]) {
  test(`an injected append cursor is independent of subsequent inode size: ${replacement}`, async () => {
    const fixtureFs = fixture({ "/output": "abcdef" });
    const stdin = (async function* () {
      yield bytes("XY");
      const editor = fixtureFs.fs.openSync("/output", "r+");
      try {
        fixtureFs.fs.ftruncateSync(editor, bytes(replacement).length);
        fixtureFs.fs.writeSync(editor, bytes(replacement), 0, bytes(replacement).length, 0);
      } finally { fixtureFs.fs.closeSync(editor); }
      yield bytes("\0\0");
    })();
    const result = await run(["of=/output", "bs=2", "seek=1", "oflag=append", "conv=notrunc,sparse", "status=none"], undefined, { stdin }, { openFile: fixtureFs.openFile });
    assert.equal(result.exitCode, 0, result.stderr);
    const expected = replacement.length >= 10 ? replacement : replacement.padEnd(10, "\0");
    assert.deepEqual(new Uint8Array(fixtureFs.fs.readFileSync("/output") as Buffer), bytes(expected));
    assert.deepEqual(fixtureFs.writes, [2]);
  });
}

test("cancellation during retained-size observation blocks a new sparse extension", async () => {
  const controller = new AbortController();
  let extensions = 0;
  let closed = 0;
  await assert.rejects(run(["of=/out", "bs=2", "conv=notrunc,sparse", "status=none"], bytes("\0\0"), {
    signal: controller.signal,
  }, { async openFile(context, request) {
    if (request.direction === "input") return openDdFile(context, request);
    return {
      type: "file", size: 0n,
      async seek() {},
      async getSize() { controller.abort(false); return 0n; },
      async truncate() { extensions++; },
      async close() { closed++; },
    };
  } }), reason => reason === false);
  assert.equal(extensions, 0);
  assert.equal(closed, 1);
});

test("excl/nocreat and flags are admitted by the injected opener", async () => {
  const fixtureFs = fixture({ "/exists": "old" });
  for (const args of [["of=/exists", "conv=excl"], ["of=/absent", "conv=nocreat"]]) {
    const result = await run([...args, "status=none"], bytes("new"), {}, { openFile: fixtureFs.openFile });
    assert.equal(result.exitCode, 1);
  }
  assert.equal(fixtureFs.fs.readFileSync("/exists", "utf8"), "old");
  const flags = ["direct", "nocache", "directory", "nofollow", "nolinks", "noatime", "nonblock", "noctty", "cio", "dsync", "sync"];
  for (const flag of flags) {
    const current = fixture({ "/input": "abc" });
    assert.equal((await run(["if=/input", `iflag=${flag}`, "count=0", "status=none"], undefined, {}, { openFile: current.openFile })).exitCode, 0);
    assert.equal(current.requests[0]!.flags.has(flag), true);
  }
});

test("fsync and fdatasync are forwarded after copying, including count=0", async () => {
  for (const conversion of ["fsync", "fdatasync", "fsync,fdatasync"]) {
    const fixtureFs = fixture({});
    const result = await run(["of=/out", "count=0", `conv=${conversion}`, "status=none"], undefined, {}, { openFile: fixtureFs.openFile });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(fixtureFs.synchronizations, conversion === "fsync,fdatasync" ? [true, false] : [conversion === "fdatasync"]);
  }
});

test("fdatasync fallback and synchronization after write failure remain observable", async () => {
  const calls: boolean[] = [];
  const openFile: DdFileOpener = async (context, request) => request.direction === "input" ? openDdFile(context, request) : {
    async write() { throw new FsError("ENOSPC"); },
    async sync(dataOnly) { calls.push(dataOnly); if (dataOnly) throw new FsError("EINVAL"); },
    async close() {},
  };
  const result = await run(["conv=fdatasync", "bs=2", "status=none"], bytes("ab"), {}, { openFile });
  assert.equal(result.exitCode, 1);
  assert.deepEqual(calls, [true, false]);
  assert.equal(result.stderr, "dd: error writing 'standard output': No space left on device\n");
});

test("a failing sync diagnostic cannot replace the original escaping diagnostic failure", async () => {
  for (const primary of [new Error("original diagnostic failure"), undefined, 0]) {
    let reports = 0;
    let closed = 0;
    const secondary = new Error("secondary sync diagnostic failure");
    const openFile: DdFileOpener = async (context, request) => request.direction === "input" ? openDdFile(context, request) : {
      async write() { throw new FsError("ENOSPC"); },
      async sync() { throw new FsError("EIO"); },
      async close() { closed++; },
    };
    await assert.rejects(run(["conv=fsync", "status=none"], bytes("abc"), {
      stderr: { async write() { throw reports++ === 0 ? primary : secondary; } },
    }, { openFile }), reason => reason === primary);
    assert.equal(reports, 2);
    assert.equal(closed, 1);
  }
});

test("caller cancellation during sync outranks later sync and close failures", async () => {
  for (const reason of [0, false, null, new Error("caller canceled")]) {
    const controller = new AbortController();
    const synchronizations: boolean[] = [];
    let closed = 0;
    const openFile: DdFileOpener = async (context, request) => request.direction === "input" ? openDdFile(context, request) : {
      async write(chunk) { return chunk.length; },
      async sync(dataOnly) { synchronizations.push(dataOnly); controller.abort(reason); throw new FsError("EIO"); },
      async close() { closed++; throw new FsError("EBADF"); },
    };
    await assert.rejects(run(["conv=fsync,fdatasync", "status=none"], bytes("abc"), { signal: controller.signal }, { openFile }), error => error === reason);
    assert.deepEqual(synchronizations, [true]);
    assert.equal(closed, 1);
  }
});

test("missing synchronization methods report unsupported operations and still close", async () => {
  let closed = 0;
  const openFile: DdFileOpener = async (context, request) => request.direction === "input" ? openDdFile(context, request) : {
    async close() { closed++; },
  };
  const result = await run(["count=0", "conv=fdatasync,fsync", "status=none"], undefined, {}, { openFile });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stderr, "dd: fdatasync failed for 'standard output': Operation not supported\ndd: fsync failed for 'standard output': Operation not supported\n");
  assert.equal(closed, 1);
});

test("noerror,sync recovers a failed read by seeking and pads the unread block", async () => {
  let offset = 0n;
  const seeks: bigint[] = [];
  const openFile: DdFileOpener = async (context, request) => request.direction === "output" ? openDdFile(context, request) : {
    async read(size) {
      if (offset === 2n) throw new FsError("EIO");
      const data = bytes("abcdef").subarray(Number(offset), Number(offset) + size);
      offset += BigInt(data.length);
      return data;
    },
    async seek(position) { seeks.push(position); offset = position; },
    async close() {},
  };
  const result = await run(["bs=2", "count=3", "conv=noerror,sync", "status=none"], undefined, {}, { openFile });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.stdout, bytes("ab\0\0ef"));
  assert.deepEqual(seeks, [4n]);
});

test("noerror does not reinterpret a terminated opaque generator as a recoverable FIFO", async () => {
  let closed = 0;
  const stdin = (async function* () {
    try { yield bytes("AB"); throw new FsError("EIO"); }
    finally { closed++; }
  })();
  const result = await run(["bs=4", "conv=noerror,sync", "status=none"], undefined, { stdin });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stderr, "dd: 'standard input': read-error recovery not supported by this input\n");
  assert.deepEqual(result.stdout, bytes("AB\0\0"));
  assert.equal(closed, 1);
});

test("a trusted resumable FIFO cannot use noerror to bypass the read-operation budget", async () => {
  let reads = 0, closed = 0;
  const result = await run(["bs=4", "count=1", "conv=noerror", "status=none"], undefined, {}, {
    maxReadOperations: 3,
    async openFile(context, request) {
      if (request.direction === "output") return openDdFile(context, request);
      return { type: "fifo", async read() { reads++; throw new FsError("EIO"); }, async close() { closed++; } };
    },
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stderr, "dd: input operation limit exceeded\n");
  assert.equal(reads, 3);
  assert.equal(closed, 1);
});

test("partial writes are retried, accounted, and a failing write is not replayed", async () => {
  let calls = 0;
  const output: number[] = [];
  const handle: DdFileHandle = {
    async write(chunk) {
      if (++calls === 3) throw new FsError("ENOSPC");
      output.push(chunk[0]!);
      return 1;
    },
    async close() {},
  };
  const openFile: DdFileOpener = async (context, request) => request.direction === "output" ? handle : openDdFile(context, request);
  const result = await run(["bs=4", "status=noxfer"], bytes("abcd"), {}, { openFile });
  assert.equal(result.exitCode, 1);
  assert.deepEqual(output, [97, 98]);
  assert.equal(result.stderr, "dd: error writing 'standard output': No space left on device\n1+0 records in\n0+0 records out\n");
});

test("output failures close both streams without hanging on unconsumed pipe data", async () => {
  const fs = createMemoryFileSystem();
  Object.defineProperty(fs, "capabilities", { value: Object.freeze({ ...fs.capabilities, open: false }) });
  fs.writeStream = async (_path, source) => {
    for await (const chunk of source) {
      assert.ok(chunk.length > 0);
      throw new FsError("ENOSPC");
    }
  };
  const result = await run(["of=/out", "bs=2", "status=none"], bytes("abcdef"), { fs });
  assert.equal(result.exitCode, 1);
  assert.ok(result.stderr.includes("No space left on device"));
});

test("cleanup is registered before acquisitions and closes a late admitted handle once", async () => {
  let cleanup!: () => void | Promise<void>;
  let release!: (handle: DdFileHandle) => void;
  let admitted!: () => void;
  const started = new Promise<void>(resolve => { admitted = resolve; });
  let closed = 0;
  const controller = new AbortController();
  const reason = new Error("cancel acquisition");
  const execution = run(["count=0", "status=none"], undefined, {
    signal: controller.signal, registerCleanup(callback) { cleanup = callback; },
  }, { openFile: async () => {
    assert.ok(cleanup);
    admitted();
    return new Promise<DdFileHandle>(resolve => { release = resolve; });
  } });
  await started;
  controller.abort(reason);
  const cleaning = cleanup();
  release({ async close() { closed++; } });
  await assert.rejects(execution, error => error === reason);
  await cleaning;
  await cleanup();
  assert.equal(closed, 1);
});

test("logical output offsets are admitted against limits before truncation", async () => {
  const fixtureFs = fixture({ "/out": "original" });
  const result = await run(["of=/out", "seek=17B", "count=0", "status=none"], undefined, {}, { openFile: fixtureFs.openFile, maxTransferBytes: 16 });
  assert.equal(result.exitCode, 1);
  assert.ok(result.stderr.includes("limit"));
  assert.equal(fixtureFs.fs.readFileSync("/out", "utf8"), "original");
});

test("registered cleanup does not replay a successfully diagnosed DD close failure", async () => {
  const callbacks: (() => void | Promise<void>)[] = [];
  const acknowledged: unknown[] = [];
  const closeError = new FsError("EIO");
  let closed = 0;
  const result = await run(["of=/out", "count=0", "status=none"], undefined, {
    registerCleanup(callback) { callbacks.push(callback); },
  }, { async openFile(context, request) {
    if (request.direction === "input") return openDdFile(context, request);
    return {
      async close() { closed++; throw closeError; },
      acknowledgeCloseFailure(reason: unknown) { acknowledged.push(reason); return reason === closeError; },
    };
  } });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stderr, "dd: closing output file '/out': Input/output error\n");
  for (const callback of callbacks) { await callback(); await callback(); }
  assert.equal(closed, 1);
  assert.deepEqual(acknowledged, [closeError]);
});

test("failed close diagnostics preserve falsey primary errors and unacknowledged cleanup failures", async () => {
  for (const primary of [undefined, false, 0]) {
    const callbacks: (() => void | Promise<void>)[] = [];
    const closeError = new FsError("EIO");
    let closed = 0;
    let acknowledgements = 0;
    await assert.rejects(run(["of=/out", "count=0", "status=none"], undefined, {
      registerCleanup(callback) { callbacks.push(callback); },
      stderr: { async write() { throw primary; } },
    }, { async openFile(context, request) {
      if (request.direction === "input") return openDdFile(context, request);
      return {
        async close() { closed++; throw closeError; },
        acknowledgeCloseFailure() { acknowledgements++; return true; },
      };
    } }), reason => reason === primary);
    for (const callback of callbacks) await assert.rejects(async () => callback(), reason => reason === closeError);
    assert.equal(closed, 1);
    assert.equal(acknowledgements, 0);
  }
});

test("cancellation during a close diagnostic never acknowledges the close failure", async () => {
  const controller = new AbortController();
  let acknowledgements = 0;
  await assert.rejects(run(["of=/out", "count=0", "status=none"], undefined, {
    signal: controller.signal,
    stderr: { async write() { controller.abort(false); } },
  }, { async openFile(context, request) {
    if (request.direction === "input") return openDdFile(context, request);
    return {
      async close() { throw new FsError("EIO"); },
      acknowledgeCloseFailure() { acknowledgements++; return true; },
    };
  } }), reason => reason === false);
  assert.equal(acknowledgements, 0);
});
