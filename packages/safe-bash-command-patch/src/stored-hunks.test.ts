import assert from "node:assert/strict";
import test from "node:test";
import { toByteSource, type CommandContext } from "safe-bash-contracts";
import { Budget } from "safe-bash-diff-engine/shared";
import { applyHunks, parseUnified, type HunkApplication, type HunkOutcome, type PatchLine } from "./unified.js";
import { applyStoredHunks } from "./stored-hunks.js";
import { TargetDocuments, targetBytes } from "./stored-target.js";
import { filesystem } from "./helpers.test.js";

for (const [original, options] of [
  ["head\nold\ntail\n", {}],
  ["head\nold\ntail\n", { ifdef: "FLAG" }],
  ["head\nother\ntail\n", { merge: "merge" }],
  ["head\nother\ntail\n", { merge: "diff3" }],
  ["head\nnew\ntail\n", { merge: "diff3" }],
] as const) test(`stored hunk matching avoids copied line lists: ${JSON.stringify({ original, options })}`, async () => {
  const fs = await filesystem();
  const context: CommandContext = { fs, cwd: "/work", env: {}, command: "patch", args: [], signal: new AbortController().signal,
    stdin: toByteSource(""), stdout: { async write() {} }, stderr: { async write() {} } };
  const budget = new Budget(context, {}), documents = new TargetDocuments(budget);
  try {
    const [patch] = await parseUnified("--- target\n+++ target\n@@ -1,3 +1,3 @@\n head\n-old\n+new\n tail\n", budget);
    const expectedOutcomes: HunkOutcome[] = [], actualOutcomes: HunkOutcome[] = [];
    const application: HunkApplication = { ...options, partial: true };
    const expected = await applyHunks(original, patch!, 2, new Budget(context, {}), false, { ...application, outcomes: expectedOutcomes });
    const guarded = { ...patch!, hunks: patch!.hunks.map(hunk => ({ ...hunk, lines: new Proxy(hunk.lines, {
      get(target, key, receiver) { if (["filter", "map", "slice"].includes(String(key))) assert.fail(`copied hunk lines: ${String(key)}`); return Reflect.get(target, key, receiver); },
    }) })) };
    const result = await applyStoredHunks(await documents.load(targetBytes(original)), guarded, 2, budget, false,
      { ...application, outcomes: actualOutcomes }, documents);
    let actual = "";
    for await (const bytes of result.range(0, result.size)) actual += new TextDecoder().decode(bytes);
    assert.equal(actual, expected);
    assert.deepEqual(actualOutcomes, expectedOutcomes);
  } finally { await documents.close(); }
  assert.deepEqual(await fs.readdir("/work"), []);
});

for (const failure of ["none", "storage", "cancel"]) test(`generated hunk indexes spill through caller storage: ${failure}`, async t => {
  const fs = await filesystem();
  const controller = new AbortController(), reason = new Error("hunk spill stopped");
  const context: CommandContext = { fs, cwd: "/work", env: {}, command: "patch", args: [], signal: controller.signal,
    stdin: toByteSource(""), stdout: { async write() {} }, stderr: { async write() {} } };
  const budget = new Budget(context, {}), documents = new TargetDocuments(budget);
  const count = 8192, block = new TextEncoder().encode("same\n".repeat(32));
  const original = await documents.load({ async *[Symbol.asyncIterator]() { for (let at = 0; at < count; at += 32) yield block; } });
  // Generate metadata on demand so the fixture cannot hide another retained list.
  const lines = new Proxy([] as PatchLine[], { get(_target, key) {
    if (key === "length") return count * 2;
    if (typeof key === "string" && String(Number(key)) === key) {
      const index = Number(key);
      return index >= 0 && index < count * 2 ? { kind: index < count ? "-" : "+", text: index < count ? "same\n" : "next\n" } : undefined;
    }
    assert.fail(`unexpected hunk collection access: ${String(key)}`);
  } });
  let opened = 0, closed = 0, writes = 0;
  const open = fs.open.bind(fs);
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
  try {
    const result = applyStoredHunks(original, { oldPath: "target", newPath: "target", oldEpoch: false, newEpoch: false,
      hunks: [{ oldStart: 1, oldCount: count, newStart: 1, newCount: count, lines }] }, 0, budget, false, {}, documents);
    if (failure !== "none") await assert.rejects(result, error => error === reason);
    else {
      const output = await result;
      assert.equal(output.length, count); assert.equal(output.size, count * 5);
      let position = 0;
      for await (const bytes of output.range(0, output.size)) for (const byte of bytes) assert.equal(byte, "next\n".charCodeAt(position++ % 5));
    }
  } finally { await documents.close(); }
  assert.ok(writes > 0); assert.equal(closed, opened);
  assert.deepEqual(await fs.readdir("/work"), []);
});
