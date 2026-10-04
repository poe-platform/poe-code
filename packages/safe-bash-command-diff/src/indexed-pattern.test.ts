import assert from "node:assert/strict";
import test from "node:test";
import { Budget } from "safe-bash-diff-engine/shared";
import { filesystem, run } from "./helpers.test-support.js";

const fallback = ["-I", "^\\(__unused_ignore_pattern__\\)\\1$"];
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
      const expected = await run("diff", [...fallback, ...args], { files });
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
