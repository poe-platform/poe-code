import assert from "node:assert/strict";
import test from "node:test";
import { Budget } from "safe-bash-diff-engine/shared";
import { toByteSource, type CommandContext } from "safe-bash-contracts";
import { StoredExclusions } from "./stored-exclusions.js";
import { flags } from "./diff-options.js";
import { filesystem, run } from "./helpers.test-support.js";

test("diff stages exclusion files without whole-file reads or a compiled-pattern list", async t => {
  const fs = await filesystem({ "left/skip-one": "old\n", "right/skip-one": "new\n", "left/keep": "old\n", "right/keep": "new\n" });
  await fs.writeStream("/work/patterns", { async *[Symbol.asyncIterator]() {
    const encoder = new TextEncoder(), block = new Uint8Array(16384).fill(122);
    for (let index = 0; index < 128; index++) yield encoder.encode(`unused-${index}\n`);
    yield block; yield encoder.encode("\nskip*\n"); block.fill(0);
  } });
  const read = Budget.prototype.readDiff;
  t.mock.method(Budget.prototype, "readDiff", async function(this: Budget, ...args: Parameters<typeof read>) {
    assert.notEqual(args[0], "/work/patterns", "read an entire exclusion file");
    return read.apply(this, args);
  });
  const result = await run("diff", ["-rq", "-X", "patterns", "left", "right"], { fs });
  assert.equal(result.exitCode, 1, result.stderr);
  assert.equal(result.stdout, "Files left/keep and right/keep differ\n");
});

for (const failure of ["none", "write", "cancel"]) test(`stored exclusions spill and clean up: ${failure}`, async t => {
  const fs = await filesystem({ patterns: `${"z".repeat(8192)}\n[[:upper:]]*\n` });
  const controller = new AbortController(), reason = new Error("exclusion storage stopped");
  const context: CommandContext = { fs, cwd: "/work", env: {}, command: "diff", args: [], signal: controller.signal,
    stdin: toByteSource(""), stdout: { async write() {} }, stderr: { async write() {} } };
  const exclusions = new StoredExclusions(new Budget(context, {}));
  let opened = 0, closed = 0, writes = 0;
  const open = fs.open.bind(fs);
  t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    const handle = await open(...args); opened++;
    return new Proxy(handle, { get(target, key) {
      if (key === "write") return async (...args: Parameters<typeof handle.write>) => {
        assert.ok(args[0].length <= 16384); writes++;
        if (failure === "write") throw reason;
        if (failure === "cancel") controller.abort(reason);
        return target.write(...args);
      };
      if (key === "close") return async (...args: Parameters<typeof handle.close>) => { closed++; return target.close(...args); };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    } });
  });
  try {
    const pending = exclusions.load(flags(["-X", "patterns", "left", "right"]));
    if (failure !== "none") await assert.rejects(pending, error => error === reason);
    else {
      await pending;
      assert.equal(await exclusions.matches("Zebra"), true);
      assert.equal(await exclusions.matches("zebra"), false);
      assert.equal(await exclusions.matches("z".repeat(8192)), true);
    }
  } finally { await exclusions.close(); }
  assert.ok(writes > 0); assert.equal(opened, closed);
  assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name), ["patterns"]);
});

for (const [pattern, name, matches] of [
  ["\\141", "a", true], ["\\x61", "a", true], ["\\d", "5", true], ["\\B*", "-", true],
  ["\\y*", "word", true], ["\\<a\\>", "a", true], ["foo\\", "foo$tail", true],
  ["[!a-c]x", "dx", true], ["[!a-c]x", "ax", false],
] as const) test(`stored exclusion preserves byte escape semantics: ${pattern}`, async () => {
  const fs = await filesystem(), context: CommandContext = { fs, cwd: "/work", env: {}, command: "diff", args: [], signal: new AbortController().signal,
    stdin: toByteSource(""), stdout: { async write() {} }, stderr: { async write() {} } };
  const exclusions = new StoredExclusions(new Budget(context, {}));
  try {
    await exclusions.load(flags(["-x", pattern, "left", "right"]));
    assert.equal(await exclusions.matches(name), matches);
  } finally { await exclusions.close(); }
});

test("stored exclusions do not allocate regex state against the input quota", async () => {
  const files = { "left/a": "123456", "right/a": "123456" };
  const success = await run("diff", ["-rq", "-x", "\\B", "left", "right"], { files, options: { maxInputBytes: 12 } });
  assert.equal(success.exitCode, 0, success.stderr);
  const limited = await run("diff", ["-rq", "-x", "\\B", "left", "right"], { files, options: { maxInputBytes: 10 } });
  assert.equal(limited.exitCode, 2);
  assert.match(limited.stderr, /input byte limit exceeded/);
});
