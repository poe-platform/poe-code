import assert from "node:assert/strict";
import { test } from "node:test";
import { textCommands } from "../../src/commands/text.js";
import { streamCommands } from "../../src/commands/streams.js";
import { FsError } from "../../src/contracts/index.js";
import { fixture, run } from "./helpers.js";

for (const code of ["EIO", "EFBIG"] as const) {
  test(`cut preserves completed records before ${code}`, async () => {
    const stdin = { async *[Symbol.asyncIterator]() {
      yield new TextEncoder().encode("first\tline\n");
      throw new FsError(code);
    } };
    const result = await run("cut", ["-f", "1"], { commands: textCommands(), stdin });
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "first\n");
    assert.match(result.stderr, new RegExp(code));
  });
}

for (const failure of ["output", "abort"] as const) {
  test(`cut closes input after ${failure}`, async () => {
    let closed = false;
    const controller = new AbortController();
    const stdin = { async *[Symbol.asyncIterator]() {
      try {
        if (failure === "abort") controller.abort(new Error("cancelled"));
        yield new TextEncoder().encode("x".repeat(70000) + "\tend\n");
      } finally { closed = true; }
    } };
    const command = textCommands().find(command => command.name === "cut")!;
    try {
      await command.execute({ command: "cut", args: ["-f", "1"], cwd: "/work", env: {},
        fs: await fixture(), signal: controller.signal, stdin,
        stdout: { async write() { throw new FsError("EIO"); } },
        stderr: { async write() {} },
      });
    } catch (error) {
      if (failure !== "abort") throw error;
    }
    assert.equal(closed, true);
  });
}

test("cut owns large output before producer reuse", async () => {
  const bytes = Buffer.from("x".repeat(70000) + "\tend\n");
  const retained: Uint8Array[] = [];
  const command = textCommands().find(command => command.name === "cut")!;
  const result = await command.execute({ command: "cut", args: ["-f", "1"], cwd: "/work", env: {},
    fs: await fixture(), signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() { yield bytes; bytes.fill(0); } },
    stdout: { async write(chunk) { retained.push(chunk); } }, stderr: { async write() { assert.fail("unexpected diagnostic"); } },
  });
  assert.equal(result.exitCode, 0);
  assert.equal(Buffer.concat(retained).toString(), "x".repeat(70000) + "\n");
});

test("stream limits default to unlimited and accept explicit Infinity", () => {
  assert.doesNotThrow(() => streamCommands());
  assert.doesNotThrow(() => streamCommands(Infinity, Infinity));
  for (const invalid of [-1, NaN, -Infinity, 0.5]) {
    assert.throws(() => streamCommands(invalid, Infinity), RangeError);
    assert.throws(() => streamCommands(Infinity, invalid), RangeError);
  }
});

for (const code of ["EIO", "EFBIG"] as const) {
  test(`cut preserves synchronous records and closes after ${code}`, async () => {
    const signal = new AbortController().signal;
    let reads = 0;
    let closed = false;
    const iterator = {
      tryNextSync(): IteratorResult<Uint8Array> {
        if (reads++ === 0) return { done: false, value: new TextEncoder().encode("first\tline\n") };
        throw new FsError(code);
      },
      async next(): Promise<IteratorResult<Uint8Array>> { return this.tryNextSync(); },
      syncReturn() { closed = true; },
    };
    const stdin = { abortSignal: signal, [Symbol.asyncIterator]() { return iterator; } };
    const result = await run("cut", ["-f", "1"], { commands: textCommands(), stdin, signal });
    assert.equal(result.stdout, "first\n");
    assert.equal(result.exitCode, 1);
    assert.equal(closed, true);
  });
}

test("tee defaults allow more than 64 targets", async () => {
  const result = await run("tee", Array.from({ length: 65 }, (_, index) => `target-${index}`), {
    commands: streamCommands(), stdin: "content\n",
  });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(new TextDecoder().decode(await result.fs.readFile("/work/target-64")), "content\n");
});
