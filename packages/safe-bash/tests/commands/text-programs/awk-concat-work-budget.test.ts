import assert from "node:assert/strict";
import test from "node:test";
import { awkCommand } from "../../../src/commands/text-programs/awk.js";
import { textProgramCommands } from "../../../src/commands/text-programs/index.js";
import { Budget } from "../../../src/commands/text-programs/shared.js";
import { toByteSource } from "../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";
import { runVirtual } from "./helpers.js";

test("awk rejects concat work before copying the assigned result", async context => {
  const left = "a".repeat(128);
  const right = "b".repeat(128);
  const combined = left + right;
  const program = `BEGIN { value="${left}" "${right}" }`;
  let copies = 0;
  const originalFrom = Buffer.from;
  Buffer.from = new Proxy(originalFrom, {
    apply(target, receiver, args: unknown[]) {
      if (args[0] === combined && args[1] === "latin1") copies++;
      return Reflect.apply(target, receiver, args);
    },
  });
  context.after(() => { Buffer.from = originalFrom; });
  const rejected = await runVirtual("awk", { args: [program] }, { maxSteps: 16, maxBufferBytes: 512 });
  assert.equal(copies, 0, "rejected concat must not reach the ownership copy");
  assert.equal(rejected.exitCode, 2);
  assert.equal(rejected.stderr.toString(), "awk: execution step limit exceeded\n");
  assert.equal(rejected.stdout.length, 0);
  const accepted = await runVirtual("awk", { args: [program] }, { maxSteps: 512, maxBufferBytes: 512 });
  assert.equal(accepted.exitCode, 0, accepted.stderr.toString());
  assert.equal(copies, 1, "the observer recognizes an admitted ownership copy");
});

test("awk concat work limits apply through the public shell", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(textProgramCommands({ maxSteps: 16, maxBufferBytes: 512 }));
  try {
    const result = await shell.exec(`awk 'BEGIN { value="${"a".repeat(128)}" "${"b".repeat(128)}" }'`);
    assert.equal(result.exitCode, 2);
    assert.equal(result.stderr, "awk: execution step limit exceeded\n");
    assert.equal(result.stdout, "");
  } finally { await shell.dispose(); }
});

for (const fragment of ["x", "xxxxxxxx"]) {
  test(`awk charges growing accumulator bytes for ${fragment.length}-byte appends`, async () => {
    const program = `BEGIN { for (counter=0; counter<128; counter++) value=value "${fragment}" }`;
    const result = await runVirtual("awk", { args: [program] }, { maxSteps: 2048, maxBufferBytes: 2048 });
    assert.equal(result.exitCode, 2);
    assert.equal(result.stderr.toString(), "awk: execution step limit exceeded\n");
    assert.equal(result.stdout.length, 0);
  });
}

for (const [label, operands, byteCount] of [
  ["empty", '"" ""', 0],
  ["ASCII", '"ab" "cd"', 4],
  ["UTF-8", '"é" "🙂"', 6],
  ["raw", '"\\377" "\\200\\000"', 3],
] as const) {
  test(`awk concat charges exact ${label} bytes in addition to expression steps`, async () => {
    const fixture = { args: [`BEGIN { value=${operands} }`] };
    const accepted = await runVirtual("awk", fixture, { maxSteps: 6 + byteCount, maxBufferBytes: 64 });
    assert.equal(accepted.exitCode, 0, accepted.stderr.toString());
    const rejected = await runVirtual("awk", fixture, { maxSteps: 5 + byteCount, maxBufferBytes: 64 });
    assert.equal(rejected.exitCode, 2);
    assert.equal(rejected.stderr.toString(), "awk: execution step limit exceeded\n");
    assert.equal(rejected.stdout.length, 0);
  });
}

test("awk concat preserves exact UTF-8 bytes at the buffer boundary", async () => {
  const fragment = "é".repeat(16);
  const result = await runVirtual("awk", { args: [`BEGIN { ORS=""; print "${fragment}" "${fragment}" }`] }, { maxSteps: 256, maxBufferBytes: 64 });
  assert.equal(result.exitCode, 0, result.stderr.toString());
  assert.deepEqual(result.stdout, Buffer.from(fragment + fragment));
});

for (const maxSteps of [6, 256]) {
  test(`awk concat preserves buffer refusal before work admission with ${maxSteps} steps`, async () => {
    const fragment = "é".repeat(16);
    const result = await runVirtual("awk", { args: [`BEGIN { value="${fragment}" "${fragment}x" }`] }, { maxSteps, maxBufferBytes: 64 });
    assert.equal(result.exitCode, 2);
    assert.equal(result.stderr.toString(), "awk: text buffer limit exceeded\n");
    assert.equal(result.stdout.length, 0);
  });
}

test("awk concat preserves raw high bytes and NUL", async () => {
  const result = await runVirtual("awk", { args: ['BEGIN { ORS=""; print "\\377" "\\200\\000" }'] }, { maxSteps: 64, maxBufferBytes: 64 });
  assert.equal(result.exitCode, 0, result.stderr.toString());
  assert.deepEqual(result.stdout, Buffer.from([255, 128, 0]));
});

test("awk rejected concat retains both operand effects but stops later statements", async () => {
  const program = `function mark(label) { printf "%s", label; return "${"x".repeat(128)}" } BEGIN { value=mark("L") mark("R"); printf "after" }`;
  const result = await runVirtual("awk", { args: [program] }, { maxSteps: 128, maxBufferBytes: 512 });
  assert.equal(result.exitCode, 2);
  assert.equal(result.stderr.toString(), "awk: execution step limit exceeded\n");
  assert.equal(result.stdout.toString(), "LR");
});

test("awk concat converts after both operands and preserves numeric and unset values", async () => {
  const result = await runVirtual("awk", { args: ['BEGIN { CONVFMT="%.1f"; print 1.25 (CONVFMT="%.2f"); print 12 ""; print missing "" }'] }, { maxSteps: 256, maxBufferBytes: 64 });
  assert.equal(result.exitCode, 0, result.stderr.toString());
  assert.equal(result.stdout.toString(), "1.25%.2f\n12\n\n");
});

for (const reason of [new Error("concat admission cancelled"), null]) {
  test(`awk concat work admission preserves cancellation reason ${String(reason)}`, async context => {
    const controller = new AbortController();
    const step = Budget.prototype.step;
    context.mock.method(Budget.prototype, "step", function (this: Budget, count = 1) {
      if (count === 256) controller.abort(reason);
      return step.call(this, count);
    });
    await assert.rejects(Promise.resolve(awkCommand({ maxSteps: 512, maxBufferBytes: 512 }).execute({
      command: "awk", args: [`BEGIN { value="${"a".repeat(128)}" "${"b".repeat(128)}" }`],
      cwd: "/", env: {}, fs: new MemoryFileSystem(), signal: controller.signal, stdin: toByteSource(""),
      stdout: { async write() { assert.fail("cancelled concat must not write stdout"); } },
      stderr: { async write() { assert.fail("cancelled concat must not write diagnostics"); } },
    })), (error: unknown) => Object.is(error, reason));
    assert.equal(controller.signal.aborted, true);
  });
}
