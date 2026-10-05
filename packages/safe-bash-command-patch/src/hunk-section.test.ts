import assert from "node:assert/strict";
import test from "node:test";
import { toByteSource, type CommandContext } from "safe-bash-contracts";
import { Budget } from "safe-bash-diff-engine/shared";
import { unifiedHeader, validateSection } from "./hunk-section.js";
import { materializeText } from "./patch-text.js";
import { contents, filesystem, run } from "./helpers.test.js";

test("hunk header boundaries preserve Unicode with reused chunks and close iterators", async () => {
  const fs = await filesystem();
  const context: CommandContext = { fs, cwd: "/work", env: {}, command: "patch", args: [], signal: new AbortController().signal,
    stdin: toByteSource(""), stdout: { async write() {} }, stderr: { async write() {} } };
  const header = "@@ -1,2 +3,4 @@", section = " section 🦀λ\ufeff", bytes = new TextEncoder().encode(header + section);
  for (const size of [1, 2, 3, 7, 15, 16, 32]) {
    let opened = 0, closed = 0;
    const input = { length: 1, async read() { assert.fail("unexpected whole-line decoding"); },
      async body(_index: number, skip: number) {
        return { size: bytes.length - skip, terminated: false, bytes: { async *[Symbol.asyncIterator]() {
          const chunk = new Uint8Array(size); opened++;
          try {
            for (let position = skip; position < bytes.length; position += size) {
              const count = Math.min(size, bytes.length - position);
              chunk.set(bytes.subarray(position, position + count)); yield chunk.subarray(0, count);
            }
          } finally { chunk.fill(0); closed++; }
        } } };
      },
    };
    const budget = new Budget(context, {}), parsed = await unifiedHeader(input, 0, budget);
    assert.equal(parsed.header, header);
    await validateSection(parsed.section, budget, "bad section");
    assert.equal(await materializeText(parsed.section), section);
    assert.equal(opened, closed);
  }
});

test("section validation rejects separators and retires the source on errors and cancellation", async () => {
  const fs = await filesystem();
  for (const ending of ["\r", "\n", "\u2028", "\u2029", "cancel"]) {
    const controller = new AbortController(), reason = new Error("section cancelled");
    const context: CommandContext = { fs, cwd: "/work", env: {}, command: "patch", args: [], signal: controller.signal,
      stdin: toByteSource(""), stdout: { async write() {} }, stderr: { async write() {} } };
    let closed = false;
    const section = { size: 100, terminated: false, bytes: { async *[Symbol.asyncIterator]() {
      try {
        yield new TextEncoder().encode(" section");
        if (ending === "cancel") { controller.abort(reason); controller.signal.throwIfAborted(); }
        yield new TextEncoder().encode(ending);
        assert.fail("advanced malformed section");
      } finally { closed = true; }
    } } };
    await assert.rejects(validateSection(section, new Budget(context, {}), "bad section"),
      error => ending === "cancel" ? error === reason : error instanceof Error && error.message === "bad section");
    assert.equal(closed, true);
  }
});

test("unified coordinate scans retain bounded header text despite leading zeros", async () => {
  const fs = await filesystem();
  const context: CommandContext = { fs, cwd: "/work", env: {}, command: "patch", args: [], signal: new AbortController().signal,
    stdin: toByteSource(""), stdout: { async write() {} }, stderr: { async write() {} } };
  const zeros = new Uint8Array(16384).fill(48);
  let closed = false;
  const input = { length: 1, async read() { assert.fail("whole coordinate read"); },
    async body(_index: number, skip: number) {
      if (skip) return "";
      return { size: 16 * zeros.length + 13, terminated: false, bytes: { async *[Symbol.asyncIterator]() {
        try {
          yield new TextEncoder().encode("@@ -");
          for (let index = 0; index < 16; index++) yield zeros;
          yield new TextEncoder().encode("1 +1 @@");
        } finally { closed = true; }
      } } };
    },
  };
  const parsed = await unifiedHeader(input, 0, new Budget(context, {}));
  assert.ok(parsed.header.length < 128, `retained ${parsed.header.length} coordinate characters`);
  assert.equal(parsed.header, "@@ -1 +1 @@");
  assert.equal(closed, true);
});

for (const field of [0, 1, 2, 3]) test(`stored unified coordinates preserve long leading zeros in field ${field}`, async () => {
  const fs = await filesystem({ target: "old\n" });
  const values = ["1", "1", "1", "1"];
  values[field] = "0".repeat(32768) + "1";
  const result = await run("patch", ["--quiet"], { fs,
    input: `--- target\n+++ target\n@@ -${values[0]},${values[1]} +${values[2]},${values[3]} @@\n-old\n+new\n` });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(await contents(fs, "target"), "new\n");
});

for (const [digits, section, expected] of [
  ["9".repeat(32768), "", `invalid old start: ${"9".repeat(32768)}`],
  ["0".repeat(32768) + "9007199254740992", "", `invalid old start: ${"0".repeat(32768)}9007199254740992`],
  ["9".repeat(32768), " bad\rsection", "malformed unified hunk header"],
] as const) test(`stored coordinate errors preserve bounded diagnostic and precedence: ${digits[0]} ${section}`, async () => {
  const fs = await filesystem({ target: "old\n" });
  const result = await run("patch", [], { fs, input: `--- target\n+++ target\n@@ -${digits} +1 @@${section}\n-old\n+new\n` });
  assert.equal(result.exitCode, 2);
  assert.equal(result.stderr, `patch: ${expected.length > 1000 ? expected.slice(0, 1000) + "…" : expected}\n`);
  assert.equal(await contents(fs, "target"), "old\n");
});

test("unified coordinate scanning preserves the largest safe integer", async () => {
  const fs = await filesystem({ target: "old\n" });
  const result = await run("patch", ["--quiet"], { fs,
    input: "--- target\n+++ target\n@@ -9007199254740991,1 +1,1 @@\n-old\n+new\n" });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(await contents(fs, "target"), "new\n");
});
