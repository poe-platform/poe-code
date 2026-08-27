import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { FsError, type ByteSource } from "../../../../src/contracts/index.js";
import { runTable, fixture } from "../../table-text/helpers.js";
import type { TableCase } from "../../table-text/cases.js";
import type { Row } from "../support.js";
import { direct, profileMatch, shell } from "./support.js";

const initial: { focused: { fixture: TableCase; native: Row }[] } = JSON.parse(await readFile(new URL("initial-red.json", import.meta.url), "utf8"));
for (const entry of initial.focused) {
  test(`pinned lifecycle: ${entry.fixture.name}`, async () => {
    for (const actual of [await direct(entry.fixture), await shell(entry.fixture, true), await shell(entry.fixture, false)]) {
      assert.ok(profileMatch(actual, entry.native), JSON.stringify({ actual, expected: entry.native }));
      const diagnostic = Buffer.from(entry.native.stderrHex, "hex").toString();
      if (diagnostic.includes("Bad file descriptor")) assert.equal(actual.stderrHex, entry.native.stderrHex);
      else if (diagnostic.includes("not in sorted order")) {
        assert.match(Buffer.from(actual.stderrHex, "hex").toString(), /file 1 is not in sorted order/u);
        assert.doesNotMatch(Buffer.from(actual.stderrHex, "hex").toString(), /Bad file descriptor/u);
      }
    }
  });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test("one shared cursor owns reused Buffer chunks until exhaustion", async () => {
  const input = Buffer.from("a\na\nb\nb\nc\n");
  const fragment = Buffer.alloc(3);
  let starts = 0, finished = 0;
  const source: ByteSource = { async *[Symbol.asyncIterator]() {
    starts++;
    try {
      for (let offset = 0; offset < input.length; offset += fragment.length) {
        const length = Math.min(fragment.length, input.length - offset);
        input.copy(fragment, 0, offset, offset + length);
        yield fragment.subarray(0, length);
      }
    } finally { finished++; }
  } };
  const result = await runTable(fixture("comm", ["-", "-"]), {}, { stdin: source });
  assert.equal(result.stdoutHex, "0909610a0909620a630a");
  assert.equal(result.exitCode, 1);
  assert.equal(result.stderr, "comm: -: Bad file descriptor\n");
  assert.equal(starts, 1);
  assert.equal(finished, 1);
});

test("producer failure wins over duplicate close", async () => {
  let finished = 0;
  async function* source() {
    try { yield Buffer.from("a\na\n"); throw new Error("producer failed"); }
    finally { finished++; }
  }
  const result = await runTable(fixture("comm", ["--total", "-", "-"]), {}, { stdin: source() });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdoutHex, "0909610a");
  assert.equal(result.stderr, "comm: producer failed\n");
  assert.equal(finished, 1);
});

test("blocked shared read cancellation preserves exact errno-shaped reason", async () => {
  const entered = deferred(), controller = new AbortController();
  const reason = new FsError("ENOENT", { message: "cancel shared read" });
  let starts = 0, returns = 0;
  const stdin: ByteSource = { [Symbol.asyncIterator]() {
    starts++;
    return {
      async next() { entered.resolve(); return new Promise<IteratorResult<Uint8Array>>(() => {}); },
      async return() { returns++; throw new Error("late cleanup rejection"); },
    };
  } };
  const running = runTable(fixture("comm", ["-", "-"]), {}, { stdin, signal: controller.signal });
  const rejected = assert.rejects(running, error => error === reason);
  await entered.promise;
  controller.abort(reason);
  await rejected;
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(starts, 1);
  assert.equal(returns, 1);
});

test("blocked output applies backpressure and cancellation without duplicate-close masking", async () => {
  const entered = deferred(), controller = new AbortController();
  const reason = new FsError("EBADF", { message: "cancel shared output" });
  let reads = 0, finished = 0;
  async function* source() {
    try { for (const text of ["a\n", "a\n", "b\n"]) { reads++; yield Buffer.from(text); } }
    finally { finished++; }
  }
  const running = runTable(fixture("comm", ["-", "-"]), {}, { stdin: source(), signal: controller.signal, stdout: { async write() { entered.resolve(); await new Promise<void>(() => {}); } } });
  const rejected = assert.rejects(running, error => error === reason);
  await entered.promise;
  assert.equal(reads, 2);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(reads, 2);
  controller.abort(reason);
  await rejected;
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(finished, 1);
});

test("downstream EPIPE remains the actual failure", async () => {
  let finished = 0;
  async function* source() {
    try { yield Buffer.from("a\na\nb\n"); }
    finally { finished++; }
  }
  const result = await runTable(fixture("comm", ["-", "-"]), {}, { stdin: source(), stdout: { async write() { throw new FsError("EPIPE", { message: "closed downstream" }); } } });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /closed downstream/u);
  assert.doesNotMatch(result.stderr, /Bad file descriptor/u);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(finished, 1);
});
