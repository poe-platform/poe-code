import assert from "node:assert/strict";
import test from "node:test";
import { Budget } from "safe-bash-diff-engine/shared";
import { filesystem, run } from "./helpers.test-support.js";

const fallback = ["-I", "^\\(__unused_ignore_pattern__\\)\\1$"];

for (const failure of ["none", "storage", "cancel"]) test(`backreferences spill text and search state to caller storage: ${failure}`, async t => {
  const fs = await filesystem();
  const block = new Uint8Array(128).fill(97);
  for (const side of ["left", "right"]) await fs.writeStream(`/work/${side}`, { async *[Symbol.asyncIterator]() {
    for (let copy = 0; copy < 2; copy++) {
      if (copy) yield new Uint8Array([120]);
      for (let index = 0; index < 8; index++) yield block;
      if (side === "right") yield new Uint8Array([97]);
    }
    yield new TextEncoder().encode(`\n${"same\n".repeat(8)}${side}\n`);
  } });
  t.mock.method(Budget.prototype, "read", async () => assert.fail("whole-file collector"));
  t.mock.method(Budget.prototype, "readDiff", async () => assert.fail("whole-file collector"));
  const controller = new AbortController(), reason = new Error("backreference spill stopped");
  const open = fs.open.bind(fs);
  let opened = 0, closed = 0, writes = 0;
  t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    const handle = await open(...args); opened++;
    return new Proxy(handle, { get(target, key) {
      if (key === "write") return async (...args: Parameters<typeof handle.write>) => {
        assert.ok(args[0].length <= 16384); writes++;
        if (failure === "storage") throw reason;
        if (failure === "cancel") controller.abort(reason);
        return target.write(...args);
      };
      if (key === "close") return async (...args: Parameters<typeof handle.close>) => { closed++; return target.close(...args); };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    } });
  });
  let stdout = "";
  const result = run("diff", ["-u", "-I", "^\\(a*\\)x\\1$", "left", "right"], { fs, signal: controller.signal,
    stdout: { async write(bytes) { assert.ok(bytes.length <= 16384); await Promise.resolve(); stdout += new TextDecoder().decode(bytes); } },
  });
  if (failure === "cancel") await assert.rejects(result, error => error === reason);
  else assert.equal((await result).exitCode, failure === "none" ? 1 : 2);
  if (failure === "none") assert.equal(stdout, "--- left\n+++ right\n@@ -7,4 +7,4 @@\n same\n same\n same\n-left\n+right\n");
  else assert.equal(stdout, "");
  assert.ok(writes > 0); assert.equal(closed, opened);
  assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name).sort(), ["left", "right"]);
});
for (const format of [[], ["-u"], ["-c"], ["-e"], ["-n"], ["-D", "FLAG"], ["-y"], ["-q", "-s"]]) {
  test(`indexed pattern filtering matches buffered output: ${format}`, async () => {
    let random = 397;
    const pick = () => (random = Math.imul(random, 1664525) + 1013904223 >>> 0);
    const lines = ["\n", "ignore one\n", "ignore two\n", "same\n", "left\n", "right\n", "😀\n", "function()\n"];
    for (let sample = 0; sample < 30; sample++) {
      const text = () => Array.from({ length: pick() % 18 }, () => lines[pick() % lines.length]!).join("");
      const files = { left: text(), right: text() };
      const args = ["-I", "^ignore", ...(sample % 2 ? ["-B"] : []), ...format, "left", "right"];
      const actual = await run("diff", args, { files });
      const expected = await run("diff", [...fallback, ...args], { files, buffered: true });
      assert.deepEqual([actual.exitCode, actual.stdout, actual.stderr], [expected.exitCode, expected.stdout, expected.stderr]);
    }
  });
}

for (const flags of [["-I", "^ *$", "-u"], ["-F", "^ *\n$", "-u"]]) {
  test(`pattern scanning avoids whole-file collection: ${flags}`, async t => {
    const fs = await filesystem();
    const block = new Uint8Array(16384).fill(32);
    for (const side of ["left", "right"]) await fs.writeStream(`/work/${side}`, { async *[Symbol.asyncIterator]() {
      for (let index = 0; index < (side === "left" || flags[0] === "-F" ? 40 : 41); index++) yield block;
      yield new TextEncoder().encode(`\n${"same\n".repeat(8)}${side}\n`);
    } });
    t.mock.method(Budget.prototype, "read", async () => assert.fail("whole-file collector"));
    t.mock.method(Budget.prototype, "readDiff", async () => assert.fail("whole-file collector"));
    const result = await run("diff", [...flags, "left", "right"], { fs });
    assert.equal(result.exitCode, 1, result.stderr);
    assert.ok(result.stdout.endsWith("-left\n+right\n"));
    if (flags[0] === "-F") assert.ok(result.stdout.includes(`@@${" ".repeat(41)}\n`));
    assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name).sort(), ["left", "right"]);
  });
}
