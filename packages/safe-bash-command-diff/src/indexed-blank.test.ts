import assert from "node:assert/strict";
import test from "node:test";
import { Budget } from "safe-bash-diff-engine/shared";
import { filesystem, run } from "./helpers.test-support.js";

for (const format of [[], ["-u"], ["-c"], ["-e"], ["-n"], ["-D", "FLAG"], ["-y"], ["-y", "--suppress-common-lines"], ["-q"]]) {
  test(`indexed blank filtering preserves buffered output: ${format}`, async () => {
    let random = 1786;
    const pick = () => (random = Math.imul(random, 1664525) + 1013904223 >>> 0);
    const lines = ["\n", " \t\r\n", "same\n", "left\n", "right\n", ".\n", "é\n"];
    for (let sample = 0; sample < 40; sample++) {
      const text = () => Array.from({ length: pick() % 20 }, () => lines[pick() % lines.length]!).join("");
      const files = { left: text(), right: text() };
      const args = ["-B", ...(sample % 2 ? ["-b"] : []), ...format, "left", "right"];
      const indexed = await run("diff", args, { files });
      // A pattern that cannot match this fixture keeps the buffered oracle path.
      const buffered = await run("diff", ["-I", "^\\(__unused_ignore_pattern__\\)\\1$", ...args], { files });
      assert.deepEqual([indexed.exitCode, indexed.stdout, indexed.stderr], [buffered.exitCode, buffered.stdout, buffered.stderr], JSON.stringify({ args, files }));
    }
  });
}

for (const failure of ["none", "cancel", "storage"] as const) test(`blank filtering scans generated long lines through caller storage: ${failure}`, async t => {
  const fs = await filesystem();
  const controller = new AbortController(), reason = new Error("blank scan stopped");
  const block = new Uint8Array(16384).fill(32);
  const common = Array.from({ length: 8 }, (_, index) => `same${index}\n`).join("");
  await fs.writeStream("/work/left", { async *[Symbol.asyncIterator]() {
    for (let index = 0; index < 40; index++) yield block;
    yield new TextEncoder().encode(`\n${common}old\n`);
  } });
  await fs.writeFile("/work/right", new TextEncoder().encode(`${common}new\n`));
  t.mock.method(Budget.prototype, "read", async () => assert.fail("whole-file collector"));
  t.mock.method(Budget.prototype, "readDiff", async () => assert.fail("whole-file collector"));
  let opened = 0, closed = 0;
  const open = fs.open.bind(fs);
  t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    opened++;
    const handle = await open(...args);
    return new Proxy(handle, { get(target, key) {
      if (key === "write") return async (...params: Parameters<typeof handle.write>) => {
        assert.ok(params[0].length <= 16384);
        if (failure === "storage") throw reason;
        if (failure === "cancel") controller.abort(reason);
        return target.write(...params);
      };
      if (key === "close") return async (...params: Parameters<typeof handle.close>) => { closed++; return target.close(...params); };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    } });
  });
  let stdout = "";
  const result = run("diff", ["-B", "-b", "-u", "left", "right"], { fs, signal: controller.signal,
    stdout: { async write(bytes) { assert.ok(bytes.length <= 16384); await Promise.resolve(); stdout += new TextDecoder().decode(bytes); } },
  });
  if (failure === "cancel") { await assert.rejects(result, error => error === reason); assert.equal(stdout, ""); }
  else if (failure === "storage") {
    const output = await result;
    assert.equal(output.exitCode, 2);
    assert.equal(output.stderr, "diff: internal error\n");
    assert.equal(stdout, "");
  }
  else { assert.equal((await result).exitCode, 1); assert.equal(stdout, "--- left\n+++ right\n@@ -7,4 +6,4 @@\n same5\n same6\n same7\n-old\n+new\n"); }
  assert.ok(opened > 0); assert.equal(closed, opened);
  assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name).sort(), ["left", "right"]);
});
