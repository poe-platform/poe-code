import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { gzipSync } from "node:zlib";
import { DEFAULT_ARCHIVE_LIMITS } from "../../../src/commands/archive/index.js";
import type { ByteSource, FileSystem } from "../../../src/contracts/index.js";
import { archive, digest, member, pattern, pax } from "./fixtures.js";
import { absent, deadline, fixture, gate, source, success, tar } from "./helpers.js";

function declaredHeader(name: string, size: number): Buffer {
  assert.ok(Number.isSafeInteger(size) && size >= 0 && size <= 0o77777777777);
  const header = Buffer.from(member({ name }).subarray(0, 512));
  header.write(`${size.toString(8).padStart(11, "0")}\0`, 124, 12, "ascii");
  header.fill(32, 148, 156);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
  return header;
}

async function names(fs: FileSystem): Promise<string[]> {
  return (await fs.readdir("/output")).map(entry => entry.name).sort();
}

async function sentinel(fs: FileSystem): Promise<void> {
  assert.equal(Buffer.from(await fs.readFile("/outside/sentinel")).toString(), "must remain unchanged");
  assert.deepEqual((await fs.readdir("/outside")).map(entry => entry.name), ["sentinel"]);
}

async function waitForRelease(release: Promise<void>, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  let onAbort!: () => void;
  try {
    await Promise.race([release, new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });
    })]);
    signal.throwIfAborted();
  } finally { signal.removeEventListener("abort", onAbort); }
}

test("B01 configured entry, PAX and expanded-archive boundaries accept exact and reject one over", async () => {
  const payload = Buffer.from("12345678901234567");
  const extension = pax(["comment", "small"]);
  const plain = archive(member({ name: "data", data: payload }));
  const vectors = [
    { label: "entry", limits: { maxEntryBytes: 17 }, good: plain,
      bad: archive(member({ name: "data", data: Buffer.concat([payload, Buffer.from("!")]) })), error: /entry byte limit/, published: false },
    { label: "PAX", limits: { maxPaxBytes: extension.length },
      good: archive(member({ name: "pax", type: "x", data: extension }), member({ name: "data", data: payload })),
      bad: archive(member({ name: "pax", type: "x", data: pax(["comment", "small!"]) }), member({ name: "data", data: payload })),
      error: /extended header byte limit/, published: false },
    { label: "expanded archive", limits: { maxArchiveBytes: plain.length }, good: gzipSync(plain),
      bad: gzipSync(Buffer.concat([plain, Buffer.alloc(1)])), error: /archive byte limit/, published: true },
  ];
  assert.equal(pax(["comment", "small!"]).length, extension.length + 1);
  assert.equal(plain.length, 2048);
  for (const vector of vectors) {
    for (const valid of [true, false]) {
      const fs = await fixture();
      await fs.writeFile("/output/data", Buffer.from("old destination"));
      const bytes = valid ? vector.good : vector.bad;
      const result = await tar(fs, [vector.label === "expanded archive" ? "-xzf" : "-xf", "-", "-C", "/output"],
        { stdin: source(bytes, 512) }, { limits: { ...vector.limits, chunkSize: 512 } });
      console.log(JSON.stringify({ label: vector.label, valid, limits: vector.limits, fixtureSha256: digest(bytes), ...result }));
      if (valid) success(result);
      else { assert.equal(result.exitCode, 2); assert.match(result.stderr, vector.error); }
      assert.deepEqual(Buffer.from(await fs.readFile("/output/data")), valid || vector.published ? payload : Buffer.from("old destination"));
      assert.deepEqual(await names(fs), ["data"]);
      await sentinel(fs);
    }
  }
});

test("B02 default 64 MiB entry declaration rejects plus one before body reads or publication", async () => {
  assert.equal(DEFAULT_ARCHIVE_LIMITS.maxEntryBytes, 67_108_864);
  for (const over of [false, true]) {
    const fs = await fixture();
    await fs.writeFile("/output/data", Buffer.from("old destination"));
    const original = await fs.stat("/output/data");
    let publications = 0;
    const writeStream = fs.writeStream!;
    const publish = writeStream.bind(fs);
    fs.writeStream = async (path, body, options) => { publications++; await publish(path, body, options); };
    const bytes = declaredHeader("data", 67_108_864 + Number(over));
    let pulls = 0;
    let returns = 0;
    const closed = gate();
    const input: ByteSource = { [Symbol.asyncIterator]() { return {
      async next() {
        pulls++;
        if (pulls === 1) return { done: false, value: bytes };
        throw new Error("independent boundary control reached body read");
      },
      async return() { returns++; closed.resolve(); return { done: true, value: undefined }; },
    }; } };
    const result = await tar(fs, ["-xf", "-", "-C", "/output"], { stdin: input });
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, over ? /entry byte limit/ : /boundary control reached body read/);
    assert.equal(pulls, over ? 1 : 2);
    await deadline(closed.promise);
    assert.equal(returns, 1);
    assert.equal(publications, over ? 0 : 1);
    if (over) {
      fs.writeStream = writeStream;
      const retained = await fs.stat("/output/data");
      assert.deepEqual(retained, original);
      assert.equal(retained.identityScope, original.identityScope);
      assert.equal(retained.dev, original.dev);
      assert.equal(retained.ino, original.ino);
    }
    assert.deepEqual(Buffer.from(await fs.readFile("/output/data")), over ? Buffer.from("old destination") : Buffer.alloc(0));
    assert.deepEqual(await names(fs), ["data"]);
    await sentinel(fs);
    console.log(JSON.stringify({ over, declaredBytes: 67_108_864 + Number(over), headerBytes: bytes.length, fixtureSha256: digest(bytes), pulls, returns, publications, ...result }));
  }
});

test("B03 small gzip amplification obeys expanded-byte budget and a valid full-size control", async () => {
  const payload = Buffer.alloc(8192, 65);
  const plain = archive(member({ name: "data", data: payload }));
  const compressed = gzipSync(plain, { level: 9 });
  assert.equal(plain.length, 9728);
  assert.ok(compressed.length < 256);
  for (const maxArchiveBytes of [2048, plain.length]) {
    const fs = await fixture();
    const result = await tar(fs, ["-xzf", "-", "-C", "/output"], { stdin: source(compressed, 31) },
      { limits: { maxArchiveBytes, chunkSize: 512 } });
    if (maxArchiveBytes === plain.length) success(result);
    else { assert.equal(result.exitCode, 2); assert.match(result.stderr, /archive byte limit/); }
    const expected: Buffer = maxArchiveBytes === plain.length ? payload : payload.subarray(0, 2048 - 512);
    assert.deepEqual(Buffer.from(await fs.readFile("/output/data")), expected);
    assert.deepEqual(await names(fs), ["data"]);
    await sentinel(fs);
    console.log(JSON.stringify({ compressedBytes: compressed.length, expandedBytes: plain.length, maxArchiveBytes, retainedBytes: expected.length, fixtureSha256: digest(compressed), ...result }));
  }
});

test("B04 late body, padding and gated gzip trailer failures retain exact partial effects", { timeout: 15000 }, async () => {
  const first = Buffer.from("accepted first file");
  const current = pattern(29);
  const prefix = Buffer.concat([member({ name: "directory", type: "5" }), member({ name: "first", data: first })]);
  const currentMember = member({ name: "current", data: current });
  const full = archive(prefix, currentMember, member({ name: "later", data: Buffer.from("later") }));
  for (const kind of ["valid", "body", "padding", "gzip trailer"] as const) {
    const fs = await fixture();
    await fs.writeFile("/output/keep", Buffer.from("keep"));
    await fs.writeFile("/output/current", Buffer.from("replaced"));
    const controller = new AbortController();
    const published = gate();
    const release = gate();
    const inputClosed = gate();
    const timer = setTimeout(() => controller.abort(new Error("late-effects deadline")), 5000);
    const write = fs.writeStream!.bind(fs);
    fs.writeStream = async (path, input, options) => { await write(path, input, options); if (path === "/output/later") published.resolve(); };
    const compressed = gzipSync(full);
    compressed[compressed.length - 8] = compressed[compressed.length - 8]! ^ 1;
    const input = kind === "gzip trailer" ? (async function* () {
      try {
        yield compressed.subarray(0, -8);
        await waitForRelease(release.promise, controller.signal);
        yield compressed.subarray(-8);
      } finally { inputClosed.resolve(); }
    })() : source(kind === "body" ? Buffer.concat([prefix, currentMember.subarray(0, 512 + 7)])
      : kind === "padding" ? Buffer.concat([prefix, currentMember.subarray(0, 512 + current.length + 3)]) : full, 197);
    const running = tar(fs, [kind === "gzip trailer" ? "-xzf" : "-xf", "-", "-C", "/output"], { stdin: input, signal: controller.signal }, { limits: { chunkSize: 512 } });
    void running.catch(() => {});
    try {
      if (kind === "gzip trailer") {
        await deadline(published.promise);
        assert.deepEqual(Buffer.from(await fs.readFile("/output/current")), current);
        assert.deepEqual(Buffer.from(await fs.readFile("/output/first")), first);
        release.resolve();
      }
      const result = await deadline(running);
      if (kind === "valid") success(result);
      else { assert.equal(result.exitCode, 2); assert.match(result.stderr, kind === "gzip trailer" ? /data check|length check|checksum|gzip/iu : /truncated archive/); }
      assert.deepEqual(Buffer.from(await fs.readFile("/output/first")), first);
      assert.deepEqual(Buffer.from(await fs.readFile("/output/current")), kind === "body" ? current.subarray(0, 7) : current);
      assert.equal((await fs.stat("/output/current")).mode & 0o777, kind === "body" ? 0o600 : 0o640);
      assert.equal((await fs.stat("/output/directory")).mode & 0o777, kind === "valid" ? 0o755 : 0o700);
      assert.equal(Buffer.from(await fs.readFile("/output/keep")).toString(), "keep");
      const laterPublished = kind === "valid" || kind === "gzip trailer";
      assert.deepEqual(await names(fs), laterPublished ? ["current", "directory", "first", "keep", "later"] : ["current", "directory", "first", "keep"]);
      if (laterPublished) assert.equal(Buffer.from(await fs.readFile("/output/later")).toString(), "later");
      else await absent(fs, "/output/later");
      await sentinel(fs);
      console.log(JSON.stringify({ kind, retainedBytes: kind === "body" ? 7 : current.length, directoryMode: kind === "valid" ? "0755" : "0700", ...result }));
    } finally {
      release.resolve();
      controller.abort(new Error("late-effects cleanup"));
      clearTimeout(timer);
      await deadline(Promise.allSettled([running]));
      if (kind === "gzip trailer") await deadline(inputClosed.promise);
    }
  }
});

test("B05 blocked compressed extraction bounds source pulls, resumes, or aborts with exact cleanup", { timeout: 15000 }, async () => {
  const payload = pattern(128 * 1024, 0x87654321);
  const bytes = gzipSync(archive(member({ name: "data", data: payload }), member({ name: "later", data: Buffer.from("later") })));
  const sourceChunkBytes = 512;
  const maximumBlockedSourceBytes = 16 * 1024;
  assert.ok(bytes.length > 8 * maximumBlockedSourceBytes);
  for (const abort of [false, true]) {
    const fs = await fixture();
    const controller = new AbortController();
    const reason = new Error("independent extraction caller abort");
    const entered = gate();
    const release = gate();
    const sourceClosed = gate();
    const returnClosed = gate();
    const writerClosed = gate();
    const timer = setTimeout(() => controller.abort(new Error("blocked extraction deadline")), 5000);
    let sourceBytes = 0;
    let pulls = 0;
    let returns = 0;
    let sourceFinalized = 0;
    let committed = 0;
    let writes = 0;
    let writerReason: unknown;
    let writerSignal: AbortSignal | undefined;
    const producer = (async function* () {
      try {
        for (let offset = 0; offset < bytes.length; offset += sourceChunkBytes) {
          controller.signal.throwIfAborted();
          const chunk = bytes.subarray(offset, offset + sourceChunkBytes);
          sourceBytes += chunk.length;
          yield chunk;
        }
      } finally { sourceFinalized++; sourceClosed.resolve(); }
    })();
    const input: ByteSource = { [Symbol.asyncIterator]() { return {
      async next() { pulls++; return producer.next(); },
      async return() {
        returns++;
        try { return await producer.return(undefined); }
        finally { returnClosed.resolve(); }
      },
    }; } };
    const write = fs.writeStream!.bind(fs);
    fs.writeStream = async (path, body, options) => {
      if (path !== "/output/data") return write(path, body, options);
      writerSignal = options?.signal;
      assert.ok(writerSignal);
      try {
        await fs.writeFile(path, Buffer.alloc(0), options);
        for await (const chunk of body) {
          if (committed === 0) {
            assert.ok(chunk.length >= 7);
            await fs.appendFile(path, chunk.subarray(0, 7), { signal: writerSignal });
            committed = 7; writes++;
            entered.resolve();
            await waitForRelease(release.promise, writerSignal);
            await fs.appendFile(path, chunk.subarray(7), { signal: writerSignal });
            committed += chunk.length - 7; writes++;
          } else {
            await fs.appendFile(path, chunk, { signal: writerSignal });
            committed += chunk.length; writes++;
          }
        }
      } catch (error) { writerReason = error; throw error; }
      finally { writerClosed.resolve(); }
    };
    const running = tar(fs, ["-xzf", "-", "-C", "/output"], { stdin: input, signal: controller.signal }, { limits: { chunkSize: 512 } });
    void running.catch(() => {});
    try {
      await deadline(entered.promise);
      await delay(30);
      const blockedPulls = pulls;
      const blockedBytes = sourceBytes;
      assert.equal(committed, 7);
      assert.equal(writes, 1);
      assert.deepEqual(Buffer.from(await fs.readFile("/output/data")), payload.subarray(0, 7));
      assert.ok(blockedBytes <= maximumBlockedSourceBytes, `source read-ahead ${blockedBytes} exceeds fixed ${maximumBlockedSourceBytes}`);
      assert.ok(blockedPulls <= maximumBlockedSourceBytes / sourceChunkBytes);
      await absent(fs, "/output/later");
      if (abort) {
        controller.abort(reason);
        await assert.rejects(deadline(running), error => error === reason);
        await deadline(Promise.all([sourceClosed.promise, returnClosed.promise, writerClosed.promise]));
        await delay(10);
        assert.equal(writerReason, reason);
        assert.equal(writerSignal?.reason, reason);
        assert.equal(returns, 1);
        assert.equal(committed, 7);
        assert.equal(writes, 1);
        assert.equal(sourceBytes, blockedBytes);
        assert.equal(pulls, blockedPulls);
        assert.deepEqual(Buffer.from(await fs.readFile("/output/data")), payload.subarray(0, 7));
        assert.deepEqual(await names(fs), ["data"]);
      } else {
        release.resolve();
        success(await deadline(running));
        await deadline(Promise.all([sourceClosed.promise, writerClosed.promise]));
        assert.equal(writerReason, undefined);
        assert.equal(sourceBytes, bytes.length);
        assert.equal(committed, payload.length);
        assert.deepEqual(Buffer.from(await fs.readFile("/output/data")), payload);
        assert.equal(Buffer.from(await fs.readFile("/output/later")).toString(), "later");
        assert.deepEqual(await names(fs), ["data", "later"]);
      }
      assert.equal(sourceFinalized, 1);
      await sentinel(fs);
      console.log(JSON.stringify({ abort, fixtureSha256: digest(bytes), compressedBytes: bytes.length, sourceChunkBytes, maximumBlockedSourceBytes, blockedBytes, blockedPulls, finalSourceBytes: sourceBytes, pulls, returns, sourceFinalized, committed, writes }));
    } finally {
      controller.abort(reason);
      release.resolve();
      clearTimeout(timer);
      await deadline(Promise.allSettled([running]));
      await deadline(Promise.all([sourceClosed.promise, writerClosed.promise]));
    }
  }
});
