import assert from "node:assert/strict";
import test from "node:test";
import { toByteSource, type CommandContext } from "safe-bash-contracts";
import { Budget } from "safe-bash-diff-engine/shared";
import { unifiedHeader, validateSection } from "./hunk-section.js";
import { materializeText } from "./patch-text.js";
import { filesystem } from "./helpers.test.js";

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
