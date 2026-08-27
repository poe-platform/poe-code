import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { createSearchCommands } from "../../../src/commands/search/index.js";
import { toByteSource, type ByteSource } from "../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { native, text } from "./harness.js";
import { nativeDelivery } from "../../stress/harness-timing-20260827/native-delivery.js";
import { trace } from "../../stress/harness-timing-20260827/trace.js";
import { withHarnessWatchdog } from "../../stress/harness-timing-20260827/watchdog.js";

trace("streaming-module-ready", {});

const input = Buffer.from("foo\n\0\nno\n");
const warning = 'binary file matches (found "\\0" byte around offset 4)\n';

async function search(stdin: ByteSource, write: (chunk: Uint8Array) => Promise<void>, signal = new AbortController().signal) {
  return createSearchCommands()[0]!.execute({
    command: "rg", args: ["foo", "-"], cwd: "/", env: {}, fs: new MemoryFileSystem(), signal, stdin, stdinIsDefault: false,
    stdout: { write }, stderr: { async write() { assert.fail("unexpected diagnostic"); } },
  });
}

for (let repetition = 1; repetition <= 3; repetition++) test(`output-acknowledged prefix delivery (native explicitly line-buffered) ${repetition}`, async () => {
  const output: Buffer[] = [];
  let returned = false;
  const virtual = withHarnessWatchdog(15000, async signal => {
    let acknowledge!: () => void;
    const delivered = new Promise<void>(resolve => { acknowledge = resolve; });
    let rejectAbort!: (reason: unknown) => void;
    const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
    void aborted.catch(() => {});
    const onAbort = () => rejectAbort(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    const source = (async function* () {
      try {
        trace("virtual-entered-read", { repetition });
        yield input.subarray(0, 4);
        await Promise.race([delivered, aborted]);
        trace("virtual-suffix-after-output", { repetition });
        yield input.subarray(4);
      } finally { returned = true; }
    })();
    try {
      return await search(source, async chunk => {
        output.push(Buffer.from(chunk));
        if (Buffer.concat(output).toString() === "foo\n") {
          trace("virtual-first-data", { repetition }); acknowledge();
        }
      }, signal);
    } finally { signal.removeEventListener("abort", onAbort); await source.return(undefined); }
  });
  const [expected, actual] = await Promise.all([nativeDelivery({ lineBuffered: true }).then(evidence => {
    trace("native-delivery", { repetition, ...evidence }); return evidence;
  }), virtual]);
  assert.deepEqual({ code: expected.code, stdout: expected.stdout, stderr: expected.stderr }, { code: 0, stdout: "foo\n" + warning, stderr: "" });
  assert.equal(expected.ready, true);
  assert.equal(expected.actualClose, true);
  assert.equal(expected.ownedListenersRemaining, 0);
  assert.deepEqual(expected.streamsDestroyed, [true, true, true]);
  assert.equal(expected.activeTimers, 0);
  assert.equal(returned, true);
  assert.equal(actual.exitCode, expected.code);
  assert.equal(Buffer.concat(output).toString(), expected.stdout);
});

test("whole-write delivery retains the distinct warning-only native result", async () => {
  const expected = native({ name: "whole-write binary", args: ["foo", "-"], stdin: [...input] });
  const output: Buffer[] = [];
  const actual = await search(toByteSource(input), async chunk => { output.push(Buffer.from(chunk)); });
  assert.equal(expected.code, 0); assert.equal(text(expected.stderr), ""); assert.equal(text(expected.stdout), warning);
  assert.equal(actual.exitCode, expected.code); assert.equal(Buffer.concat(output).toString(), text(expected.stdout));
});

for (const cancel of [false, true]) test(`binary-aware output ${cancel ? "cancels under" : "respects"} backpressure before another read`, async () => {
  const controller = new AbortController(); const reason = new Error("cancel blocked binary-aware write");
  let reads = 0; let returned = false; let started!: () => void; let release!: () => void;
  const writing = new Promise<void>(resolve => { started = resolve; });
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const chunks = [Buffer.from("foo\n"), Buffer.from("\0\nno\n")];
  const source = { [Symbol.asyncIterator]() { return {
    async next() { const chunk = chunks[reads++]; return chunk ? { done: false as const, value: chunk } : { done: true as const, value: undefined }; },
    async return() { returned = true; return { done: true as const, value: undefined }; },
  }; } };
  const output: Buffer[] = [];
  const execution = search(source, async chunk => {
    output.push(Buffer.from(chunk));
    if (output.length === 1) { started(); await blocked; }
  }, controller.signal);
  try {
    await writing; await delay(10);
    assert.equal(reads, 1, "stdout backpressure must stop input before NUL arrives");
    assert.equal(Buffer.concat(output).toString(), "foo\n");
    if (cancel) { controller.abort(reason); await assert.rejects(execution, error => error === reason); }
    else { release(); assert.equal((await execution).exitCode, 0); assert.equal(Buffer.concat(output).toString(), "foo\n" + warning); }
    assert.equal(returned, true);
  } finally { release(); await execution.catch(() => {}); }
});
