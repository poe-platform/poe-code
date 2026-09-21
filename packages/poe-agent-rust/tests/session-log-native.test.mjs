import { test } from "node:test";
import assert from "node:assert/strict";
import * as own from "../dist/session-log.js";
import * as original from "../../poe-agent/dist/runtime/session/session-store.js";
const entry = {
  kind: "user",
  id: "u\ud800",
  parentId: null,
  createdAt: "a",
  text: "hello\udc00",
  extension: JSON.parse('{"__proto__":{"safe":true}}')
};
test("memory history clones deeply, preserves serialization hooks and releases disposed records", async () => {
  for (const implementation of [original, own]) {
    const store = implementation.createMemorySessionStore("t");
    let calls = 0;
    await store.append({
      toJSON() {
        calls++;
        return entry;
      }
    });
    assert.equal(calls, 1);
    const values = await store.list();
    assert.deepEqual(values, [entry]);
    assert.equal(Object.hasOwn(values[0].extension, "__proto__"), true);
    values[0].extension.__proto__.safe = false;
    assert.deepEqual(await store.list(), [entry]);
    await store.dispose();
    assert.deepEqual(await store.list(), []);
    // The original permits re-use after disposal; do not add a terminal state.
    await store.append(entry);
    assert.deepEqual(await store.list(), [entry]);
    const cyclic = {};
    cyclic.self = cyclic;
    await assert.rejects(store.append(cyclic));
    assert.deepEqual(await store.list(), [entry]);
  }
});
test("JSONL write admission serializes effects, waits before replay and retains rejection causes", async () => {
  for (const implementation of [original, own]) {
    let text = "",
      release;
    const calls = [],
      gate = new Promise((resolve) => {
        release = resolve;
      });
    const fs = {
      async mkdir() {
        calls.push("mkdir");
      },
      async appendFile(file, data) {
        calls.push(data);
        if (calls.length === 2) await gate;
        text += data;
      },
      async readFile() {
        calls.push("read");
        return text;
      }
    };
    const store = await implementation.createJsonlSessionStore("t", "/x", { fs });
    let hooks = 0;
    const first = store.append({
        toJSON() {
          hooks++;
          return entry;
        }
      }),
      second = store.append({ ...entry, id: "v" });
    const listing = store.list();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(hooks, 1);
    assert.equal(calls.length, 2);
    release();
    await Promise.all([first, second]);
    assert.deepEqual(await listing, [entry, { ...entry, id: "v" }]);
    assert.equal(calls.at(-1), "read");
    for (const reason of [undefined, null, false, 0, "", 0n]) {
      let writes = 0;
      const bad = await implementation.createJsonlSessionStore("t", "/x", {
        fs: {
          async mkdir() {},
          async appendFile() {
            writes++;
            throw reason;
          },
          async readFile() {
            throw Error("must not read");
          }
        }
      });
      await assert.rejects(bad.append(entry), (error) => Object.is(error, reason));
      await assert.rejects(bad.append(entry), (error) => Object.is(error, reason));
      await assert.rejects(bad.list(), (error) => Object.is(error, reason));
      await assert.rejects(bad.dispose(), (error) => Object.is(error, reason));
      assert.equal(writes, 1);
    }
  }
});
test("JSONL replay preserves blank-line numbering and final-record validation", async () => {
  for (const implementation of [original, own]) {
    let text = `\ufeff  \n${JSON.stringify(entry)}\n  \n{bad\n`;
    const store = await implementation.createJsonlSessionStore("t", "/x", {
      fs: {
        async mkdir() {},
        async appendFile() {},
        async readFile() {
          return text;
        }
      }
    });
    await assert.rejects(
      store.list(),
      (error) => error.message === "Unable to parse poe-agent session entry at /x/t.jsonl:4."
    );
    text = `${JSON.stringify(entry)}\n{bad`;
    assert.deepEqual(await store.list(), [entry]);
    text = `${JSON.stringify(entry)}\n{}`;
    await assert.rejects(
      store.list(),
      (error) => error.message === "Invalid poe-agent session entry in /x/t.jsonl."
    );
  }
});

test("parser bounds reject complete and partial final records instead of discarding them", async () => {
  let extension = null;
  for (let level = 0; level < 140; level++) extension = [extension];
  let source = JSON.stringify({ ...entry, extension });
  const store = await own.createJsonlSessionStore("t", "/x", {
    fs: {
      async mkdir() {},
      async appendFile() {},
      async readFile() {
        return source;
      }
    }
  });
  await assert.rejects(
    store.list(),
    (error) => error.message === "Rust session parser limit exceeded at /x/t.jsonl:1."
  );
  source += "\n";
  await assert.rejects(
    store.list(),
    (error) => error.message === "Rust session parser limit exceeded at /x/t.jsonl:1."
  );
  const memory = own.createMemorySessionStore("t");
  await assert.rejects(memory.append({ ...entry, extension }), (error) =>
    error.message.includes("DepthLimit")
  );
  assert.deepEqual(await memory.list(), []);
});
test("all entry kinds and malformed metadata replay agree with the original validator", async () => {
  const base = { id: "id", parentId: null, createdAt: "at" },
    kinds = [
      { kind: "user", text: "text" },
      { kind: "assistant", text: "text" },
      { kind: "tool_call", tool: "name", intentId: "i", args: { opaque: true } },
      { kind: "tool_result", intentId: "i", result: { opaque: true } },
      { kind: "compaction", summary: "s", droppedIds: [null], readFiles: [1], modifiedFiles: [{}] },
      { kind: "branch_summary", fromEntryId: "i", summary: "s" },
      { kind: "fork_marker", fromEntryId: "i" }
    ];
  const samples = [null, [], {}, false, 0, "entry"];
  for (const kind of kinds) {
    const valid = { ...base, ...kind };
    samples.push(valid);
    for (const key of Object.keys(valid)) {
      if (["args", "result"].includes(key)) continue;
      const missing = { ...valid };
      delete missing[key];
      samples.push(missing);
      for (const value of [null, {}, 0, false, [], "invalid"]) {
        samples.push({ ...valid, [key]: value });
      }
    }
  }
  for (const value of samples) {
    const errors = [],
      outputs = [];
    for (const implementation of [original, own]) {
      const store = await implementation.createJsonlSessionStore("t", "/x", {
        fs: {
          async mkdir() {},
          async appendFile() {},
          async readFile() {
            return JSON.stringify(value) + "\n";
          }
        }
      });
      try {
        outputs.push(await store.list());
        errors.push(undefined);
      } catch (error) {
        outputs.push(undefined);
        errors.push(error.message);
      }
    }
    assert.deepEqual(errors[1], errors[0]);
    assert.deepEqual(outputs[1], outputs[0]);
  }
});
