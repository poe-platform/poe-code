import assert from "node:assert/strict";
import test from "node:test";
import { toByteSource, type CommandContext } from "safe-bash-contracts";
import { Budget } from "safe-bash-diff-engine/shared";
import { PatchBodyStore, patchHunk, patchLine, reverseStoredPatch } from "./stored-patch.js";
import { TargetDocuments, targetBytes } from "./stored-target.js";
import { filesystem } from "./helpers.test.js";

for (const failure of ["none", "write", "cancel"]) test(`stored hunk records replay bodies and clean up: ${failure}`, async t => {
  const fs = await filesystem(), controller = new AbortController(), reason = new Error("hunk storage stopped");
  const context: CommandContext = { fs, cwd: "/work", env: {}, command: "patch", args: [], signal: controller.signal,
    stdin: toByteSource(""), stdout: { async write() {} }, stderr: { async write() {} } };
  const documents = new TargetDocuments(new Budget(context, {})), store = new PatchBodyStore(documents);
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
  const section = (index: number) => ` section ${index} λ🦀${index === 4095 ? "ø".repeat(16385) : ""}`;
  try {
    const builder = store.beginHunks();
    const append = async () => {
      for (let index = 0; index < 8192; index++) {
        const body = store.begin();
        await body.append({ kind: "-", text: `old ${index}\n` });
        await body.append({ kind: "+", text: `new ${index}\n` });
        await builder.append({ oldStart: index + 1, newStart: index + 3, oldCount: 1, newCount: 1,
          lines: body.lines, section: section(index) });
      }
    };
    if (failure !== "none") await assert.rejects(append(), error => error === reason);
    else {
      await append();
      const patch = { oldPath: "before", newPath: "after", oldEpoch: false, newEpoch: true, hunks: builder.hunks };
      const reverse = reverseStoredPatch(patch);
      assert.equal(reverse.hunks.length, 8192);
      for (const index of [0, 1, 255, 256, 4095, 8191]) {
        const hunk = await patchHunk(reverse, index);
        assert.equal(hunk.oldStart, index + 3); assert.equal(hunk.newStart, index + 1);
        assert.equal(hunk.section, section(index));
        for (const lineIndex of [0, 1]) {
          const line = await patchLine(hunk, lineIndex);
          assert.equal(line.kind, lineIndex === 0 ? "+" : "-");
          let text = "";
          for await (const bytes of targetBytes(line.text)) text += new TextDecoder().decode(bytes);
          assert.equal(text, `${lineIndex === 0 ? "old" : "new"} ${index}\n`);
        }
      }
      const second = store.beginHunks(), body = store.begin();
      await body.append({ kind: "+", text: "separate\n" });
      await second.append({ oldStart: 0, oldCount: 0, newStart: 1, newCount: 1, lines: body.lines });
      assert.equal(second.hunks.length, 1); assert.equal(builder.hunks.length, 8192);
      assert.equal((await builder.hunks.read(8191)).section, section(8191));
      await assert.rejects(second.hunks.read(1), RangeError);
    }
  } finally { await store.close(); await documents.close(); }
  assert.ok(writes > 0); assert.equal(closed, opened); assert.deepEqual(await fs.readdir("/work"), []);
});
