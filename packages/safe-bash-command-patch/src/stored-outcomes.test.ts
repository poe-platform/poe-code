import assert from "node:assert/strict";
import test from "node:test";
import { toByteSource, type CommandContext } from "safe-bash-contracts";
import { Budget } from "safe-bash-diff-engine/shared";
import { OutcomeStore } from "./stored-outcomes.js";
import { TargetDocuments } from "./stored-target.js";
import type { Hunk } from "./unified.js";
import { filesystem, replacement, run } from "./helpers.test.js";

test("patch matching does not retain hunk outcomes in arrays", async t => {
  const push = Array.prototype.push;
  t.after(() => { Array.prototype.push = push; });
  Array.prototype.push = function(this: unknown[], ...items: unknown[]) {
    for (const item of items) if (item && typeof item === "object" && "hunk" in item && "failed" in item)
      assert.fail("retained hunk outcome array");
    return push.apply(this, items);
  };
  for (const [text, args, code] of [["old\n", [], 0], ["new\n", [], 0], ["other\n", ["--force"], 1],
    ["other\n", ["--merge=diff3"], 1]] as const) {
    const result = await run("patch", args, { input: replacement, files: { target: text } });
    assert.equal(result.exitCode, code, result.stderr);
  }
});

for (const failure of ["none", "write", "cancel"]) test(`outcome records spill and clean up after ${failure}`, async t => {
  const fs = await filesystem(), controller = new AbortController(), reason = new Error("outcome storage stopped");
  const context: CommandContext = { fs, cwd: "/work", env: {}, command: "patch", args: [], signal: controller.signal,
    stdin: toByteSource(""), stdout: { async write() {} }, stderr: { async write() {} } };
  const documents = new TargetDocuments(new Budget(context, {})), store = new OutcomeStore(documents);
  const hunk: Hunk = { oldStart: 1, oldCount: 1, newStart: 1, newCount: 1, lines: [{ kind: "-", text: "old\n" }, { kind: "+", text: "new\n" }] };
  const hunks = new Proxy([] as Hunk[], { get(_target, key) {
    if (key === "length") return 8192;
    if (typeof key === "string" && String(Number(key)) === key) return hunk;
    assert.fail(`unexpected hunk collection access: ${String(key)}`);
  } });
  const outcomes = store.create({ oldPath: "target", newPath: "target", oldEpoch: false, newEpoch: false, hunks });
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
  const expected = (index: number) => ({ hunk, index: index + 1, failed: index % 2 === 0, misordered: index % 3 === 0,
    line: index + 5, outputOffset: -index, offset: index - 8, fuzz: index % 4,
    ...(index % 5 === 0 ? { mergeRange: [index + 7, index + 9] as const } : {}),
  });
  try {
    const append = async () => { for (let index = 0; index < 8192; index++) await outcomes.push(expected(index)); };
    if (failure !== "none") await assert.rejects(append(), error => error === reason);
    else {
      await append(); assert.equal(outcomes.length, 8192);
      for (const index of [0, 1, 255, 256, 4095, 8191]) assert.deepEqual(await outcomes.at(index), expected(index));
      const last = await outcomes.pop(); assert.deepEqual(last, expected(8191));
      await outcomes.push({ ...last!, failed: false, mergeRange: [9000, 9002] });
      assert.deepEqual(await outcomes.at(8191), { ...expected(8191), failed: false, mergeRange: [9000, 9002] });
      assert.equal(outcomes.length, 8192);
    }
  } finally { await store.close(); await documents.close(); }
  assert.ok(writes > 0); assert.equal(closed, opened); assert.deepEqual(await fs.readdir("/work"), []);
});
