import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { createSearchCommands } from "../../../src/commands/search/index.js";
import { toByteSource, type ByteSource } from "../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { native, text } from "./harness.js";

const input = Buffer.from("foo\n\0\nno\n");
const warning = 'binary file matches (found "\\0" byte around offset 4)\n';

async function search(stdin: ByteSource, write: (chunk: Uint8Array) => Promise<void>, signal = new AbortController().signal) {
  return createSearchCommands()[0]!.execute({
    command: "rg", args: ["foo", "-"], cwd: "/", env: {}, fs: new MemoryFileSystem(), signal, stdin, stdinIsDefault: false,
    stdout: { write }, stderr: { async write() { assert.fail("unexpected diagnostic"); } },
  });
}

function delayedNative(): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("rg", ["--no-config", "foo", "-"], { stdio: ["pipe", "pipe", "pipe"] });
    const output: Buffer[] = []; const errors: Buffer[] = [];
    let offset = 0; let captured = 0; let failure: Error | undefined;
    const stop = (error: Error) => { failure ??= error; child.kill("SIGKILL"); };
    const deadline = setTimeout(() => stop(new Error("delayed native deadline")), 3000);
    const producer = setInterval(() => {
      child.stdin.write(input.subarray(offset, ++offset));
      if (offset === input.length) { clearInterval(producer); child.stdin.end(); }
    }, 25);
    for (const [stream, chunks] of [[child.stdout, output], [child.stderr, errors]] as const) stream.on("data", (chunk: Buffer) => {
      captured += chunk.length;
      if (captured > 1024 * 1024) stop(new Error("delayed native capture limit")); else chunks.push(chunk);
    });
    child.stdin.on("error", error => { clearInterval(producer); if ((error as NodeJS.ErrnoException).code !== "EPIPE") stop(error); });
    child.on("error", stop);
    child.on("close", (code, signal) => {
      clearInterval(producer); clearTimeout(deadline);
      if (failure || signal) reject(failure ?? new Error(`delayed native signal ${signal}`));
      else resolve({ code, stdout: Buffer.concat(output).toString(), stderr: Buffer.concat(errors).toString() });
    });
  });
}

for (let repetition = 1; repetition <= 3; repetition++) test(`matched 25ms one-byte delivery ${repetition}`, async () => {
  const output: Buffer[] = [];
  const source = (async function* () { for (const byte of input) { await delay(25); yield Uint8Array.of(byte); } })();
  const [expected, actual] = await Promise.all([delayedNative(), search(source, async chunk => { output.push(Buffer.from(chunk)); })]);
  assert.deepEqual(expected, { code: 0, stdout: "foo\n" + warning, stderr: "" });
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
