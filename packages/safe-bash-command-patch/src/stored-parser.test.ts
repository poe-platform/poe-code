import assert from "node:assert/strict";
import test from "node:test";
import { toByteSource, type CommandContext } from "safe-bash-contracts";
import { Budget } from "safe-bash-diff-engine/shared";
import { PatchBodyStore } from "./stored-patch.js";
import { TargetDocuments, targetBytes } from "./stored-target.js";
import { contents, filesystem, replacement, run } from "./helpers.test.js";

test("patch parsers do not retain hunk body records in arrays", async t => {
  const push = Array.prototype.push;
  t.after(() => { Array.prototype.push = push; });
  Array.prototype.push = function(this: unknown[], ...items: unknown[]) {
    for (const item of items) if (item && typeof item === "object" && "kind" in item && "text" in item
      && [" ", "+", "-", "!"].includes(String(item.kind))) assert.fail("retained patch body array");
    return push.apply(this, items);
  };
  for (const input of [replacement, "1c1\n< old\n---\n> new\n",
    "*** target\n--- target\n***************\n*** 1 ****\n! old\n--- 1 ----\n! new\n"]) {
    const result = await run("patch", ["target"], { input, files: { target: "old\n" } });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(await contents(result.fs, "target"), "new\n");
  }
});

for (const failure of ["none", "write", "cancel"]) test(`stored patch body spill and cleanup: ${failure}`, async t => {
  const fs = await filesystem(), controller = new AbortController(), reason = new Error("body storage stopped");
  const context: CommandContext = { fs, cwd: "/work", env: {}, command: "patch", args: [], signal: controller.signal,
    stdin: toByteSource(""), stdout: { async write() {} }, stderr: { async write() {} } };
  const documents = new TargetDocuments(new Budget(context, {})), store = new PatchBodyStore(documents);
  const text = "é".repeat(128) + "\n", body = store.begin();
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
    const append = async () => { for (let index = 0; index < 2400; index++) await body.append({ kind: index % 2 ? "+" : "-", text }); };
    if (failure !== "none") await assert.rejects(append(), error => error === reason);
    else {
      await append(); assert.equal(body.lines.length, 2400);
      const expected = new TextEncoder().encode(text);
      for (const index of [0, 1, 1200, 2399]) {
        const line = await body.lines.read(index);
        assert.equal(line.kind, index % 2 ? "+" : "-");
        let at = 0;
        for await (const bytes of targetBytes(line.text)) { assert.ok(bytes.length <= 16384); for (const byte of bytes) assert.equal(byte, expected[at++]); }
        assert.equal(at, expected.length);
      }
    }
  } finally { await store.close(); await documents.close(); }
  assert.ok(writes > 0); assert.equal(closed, opened); assert.deepEqual(await fs.readdir("/work"), []);
});
