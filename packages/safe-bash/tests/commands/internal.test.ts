import assert from "node:assert/strict";
import test from "node:test";
import { FsError, type ByteSource } from "../../src/contracts/index.js";
import { bufferLimit, collect, lines } from "../../src/commands/internal.js";

function borrowed(kind: "Buffer" | "Uint8Array", payloads: readonly number[][], events: string[]): ByteSource {
  const backing = kind === "Buffer" ? Buffer.alloc(12, 0x7e) : new Uint8Array(12).fill(0x7e);
  return (async function* () {
    try {
      for (const payload of payloads) {
        const window = backing.subarray(3, 3 + payload.length);
        window.set(payload);
        yield window;
        assert.deepEqual([...window], payload);
        assert.equal(backing[2], 0x7e);
        assert.equal(backing[11], 0x7e);
        events.push("next");
        backing.fill(0, 3, 11);
      }
    } finally {
      backing.fill(0, 3, 11);
      events.push("finally");
    }
  })();
}

for (const kind of ["Buffer", "Uint8Array"] as const) {
  test(`collect owns offset ${kind} windows across next reads and finalization`, async () => {
    const events: string[] = [];
    const payloads = [[], [0, 255, 195], [], [169, 65, 10], []];
    const result = await collect(borrowed(kind, payloads, events), new AbortController().signal, 6);
    assert.deepEqual(result, new Uint8Array([0, 255, 195, 169, 65, 10]));
    assert.deepEqual(events, [...payloads.map(() => "next"), "finally"]);
  });

  test(`lines owns unfinished ${kind} fragments without losing empty or final records`, async () => {
    const events: string[] = [];
    const payloads = [[], [65, 0], [255, 10, 10, 66], [], [195], [169]];
    const records = [];
    for await (const line of lines(borrowed(kind, payloads, events))) records.push(line);
    assert.deepEqual(records, [
      { bytes: new Uint8Array([65, 0, 255]), terminated: true },
      { bytes: new Uint8Array(), terminated: true },
      { bytes: new Uint8Array([66, 195, 169]), terminated: false },
    ]);
    assert.deepEqual(events, [...payloads.map(() => "next"), "finally"]);
  });

  test(`lines retains ${kind} fragments with a custom NUL separator`, async () => {
    const records = [];
    for await (const line of lines(borrowed(kind, [[65], [66, 0, 67], [], [68, 0]], []), 0)) records.push(line);
    assert.deepEqual(records, [
      { bytes: new Uint8Array([65, 66]), terminated: true },
      { bytes: new Uint8Array([67, 68]), terminated: true },
    ]);
  });
}

test("collect preserves its exact limit error and finalizes without mutating input", async () => {
  const window = Buffer.from([1, 2, 3]);
  let finalized = false;
  const source = (async function* () {
    try { yield window; yield window; }
    finally { assert.deepEqual(window, Buffer.from([1, 2, 3])); finalized = true; }
  })();
  await assert.rejects(collect(source, new AbortController().signal, 5), error => {
    assert.ok(error instanceof FsError);
    assert.equal(error.code, "EFBIG");
    assert.equal(error.message, "EFBIG: buffer limit exceeded (5 bytes)");
    return true;
  });
  assert.equal(finalized, true);
});

test("collect preserves cancellation identity and source finalization", async () => {
  const controller = new AbortController();
  const reason = new FsError("EIO", { message: "stop reading" });
  let finalized = false;
  const source = (async function* () {
    try {
      yield Buffer.from([1]);
      controller.abort(reason);
      yield Buffer.from([2]);
    } finally { finalized = true; }
  })();
  await assert.rejects(collect(source, controller.signal), error => error === reason);
  assert.equal(finalized, true);
});

test("collect and lines propagate source failure without changing the error", async () => {
  const failure = new Error("source failed");
  let finalized = 0;
  async function* source(): ByteSource {
    try { yield Buffer.from([65]); throw failure; }
    finally { finalized++; }
  }
  await assert.rejects(collect(source(), new AbortController().signal), error => error === failure);
  await assert.rejects(async () => { for await (const line of lines(source())) assert.fail(String(line)); }, error => error === failure);
  assert.equal(finalized, 2);
});

test("lines preserves the existing byte limit at the exact boundary and overflow", async () => {
  const bytes = Buffer.alloc(bufferLimit, 65);
  let finalized = 0;
  async function* source(extra: number): ByteSource {
    try { yield bytes; yield Buffer.from([extra]); }
    finally { finalized++; }
  }
  const records = [];
  for await (const line of lines(source(10))) records.push(line);
  assert.equal(records.length, 1);
  assert.equal(records[0]!.terminated, true);
  assert.deepEqual(records[0]!.bytes, new Uint8Array(bytes));
  await assert.rejects(async () => { for await (const line of lines(source(65))) assert.fail(String(line)); }, error => {
    assert.ok(error instanceof FsError);
    assert.equal(error.code, "EFBIG");
    assert.equal(error.message, "EFBIG: line buffer limit exceeded");
    return true;
  });
  assert.equal(finalized, 2);
  assert.equal(bytes.every(byte => byte === 65), true);
});
