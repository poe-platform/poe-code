import { test } from "node:test";
import assert from "node:assert/strict";
import * as own from "../dist/index.js";
import * as original from "../../poe-agent/dist/index.js";
function memoryFs(seed = new Map()) {
  return {
    data: seed,
    calls: [],
    async mkdir(...args) {
      this.calls.push(["mkdir", ...args]);
    },
    async writeFile(file, text, encoding) {
      this.calls.push(["write", file, encoding]);
      this.data.set(file, text);
    },
    async readFile(file) {
      this.calls.push(["read", file]);
      if (!this.data.has(file)) throw Object.assign(Error("missing"), { code: "ENOENT" });
      return this.data.get(file);
    }
  };
}
const session = {
  version: 1,
  threadId: "t\ud800",
  model: "m",
  cwd: "/x",
  createdAt: "a",
  updatedAt: "b",
  messages: [
    {
      role: "tool",
      content: [
        { type: "image", mimeType: "image/png", data: "AA==" },
        { type: "error", code: "bad", message: "error\udc00", retriable: false }
      ]
    }
  ]
};
test("session storage preserves extensions, hook effects and filesystem ordering", async () => {
  for (const implementation of [original, own]) {
    const fs = memoryFs(),
      store = implementation.createAgentSessionStore({ homeDir: "/home", fs });
    await store.save({ ...session, extension: JSON.parse('{"__proto__":{"safe":true}}') });
    assert.equal(fs.calls[0][0], "mkdir");
    assert.equal(fs.calls[1][0], "write");
    const value = await store.load(session.threadId);
    assert.deepEqual(value.messages, session.messages);
    assert.equal(Object.hasOwn(value.extension, "__proto__"), true);
    assert.equal(fs.calls[2][0], "read");
    const cyclic = { ...session };
    cyclic.self = cyclic;
    await assert.rejects(store.save(cyclic));
    assert.equal(fs.calls.at(-1)[0], "mkdir");
    for (const reason of [undefined, null, false, 0, "", 0n]) {
      const failing = implementation.createAgentSessionStore({
        homeDir: "/home",
        fs: {
          async readFile() {
            throw reason;
          }
        }
      });
      await assert.rejects(failing.load("t"), (value) => Object.is(value, reason));
    }
  }
});
test("malformed session diagnostics match the host JSON error contract", async () => {
  for (const source of ["not json", "{", "[1,]"]) {
    const errors = [];
    for (const implementation of [original, own]) {
      const fs = memoryFs(new Map([["/home/.poe-code/sessions/t.json", source]]));
      try {
        await implementation.createAgentSessionStore({ homeDir: "/home", fs }).load("t");
      } catch (error) {
        errors.push(error.message);
      }
    }
    assert.equal(errors[1], errors[0]);
  }
});
test("Rust parser limit failures do not retry an unrestricted host parse", async () => {
  let extension = null;
  for (let level = 0; level < 140; level++) extension = [extension];
  const source = JSON.stringify({ ...session, extension }),
    fs = memoryFs(new Map([["/home/.poe-code/sessions/t.json", source]])),
    store = own.createAgentSessionStore({ homeDir: "/home", fs });
  const parse = JSON.parse;
  let attempts = 0;
  JSON.parse = () => {
    attempts++;
    throw Error("unrestricted parse must not run");
  };
  try {
    await assert.rejects(store.load("t"), (error) => error.message.includes("DepthLimit"));
    assert.equal(attempts, 0);
  } finally {
    JSON.parse = parse;
  }
});
