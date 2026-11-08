import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PagedStorage } from "@poe-code/safe-fs/storage";
import { XmlBudget, resolveXmlQueryLimits } from "./limits.js";
import { StoredAttributes } from "./stored-attributes.js";

for (const count of [0, 1, 2, 3, 17, 257]) test(`stored attribute ordering handles ${count} records with a single cache page`, async () => {
  const fs = createMemoryFileSystem(), signal = new AbortController().signal;
  const storage = new PagedStorage({ fs, cwd: "/", env: {}, signal }, 1);
  const budget = new XmlBudget(resolveXmlQueryLimits(), signal, async () => {});
  const attributes = Array.from({ length: count }, (_, index) => ({
    name: "n" + index, localName: String((index * 73) % 31), namespace: "", value: String(index).repeat(80)
  }));
  const expected = [...attributes].sort((a, b) => a.localName.localeCompare(b.localName));
  const sorted = new StoredAttributes(storage, budget);
  try {
    for (const attribute of attributes) await sorted.append(attribute);
    await sorted.sort((a, b) => a.localName.localeCompare(b.localName));
    const actual = [];
    for await (const attribute of sorted) { await Promise.resolve(); actual.push(attribute); }
    assert.deepEqual(actual, expected);
    const replay = [];
    for await (const attribute of sorted) replay.push(attribute);
    assert.deepEqual(replay, expected);
  } finally { await storage.close(); }
  assert.deepEqual(await fs.readdir("/"), []);
});

for (const cancel of [false, true]) test(`stored attribute sorting preserves failure and cleanup (cancel=${cancel})`, async () => {
  const fs = createMemoryFileSystem(), controller = new AbortController(), failure = new Error("sort stopped");
  let writes = 0, active = 0, inject = false;
  const injected = new Proxy(fs, { get(target, key) {
    if (key === "open") return async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args);
      return new Proxy(handle, { get(descriptor, member) {
        if (member === "write") return async (...args: Parameters<typeof handle.write>) => {
          assert.ok(args[0].length <= 16384); assert.equal(++active, 1);
          try {
            await Promise.resolve(); writes++;
            if (inject) { if (cancel) controller.abort(failure); throw failure; }
            return await handle.write(...args);
          } finally { active--; }
        };
        const value = Reflect.get(descriptor, member, descriptor);
        return typeof value === "function" ? value.bind(descriptor) : value;
      } });
    };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const storage = new PagedStorage({ fs: injected, cwd: "/", env: {}, signal: controller.signal }, 1);
  const sorted = new StoredAttributes(storage, new XmlBudget(resolveXmlQueryLimits(), controller.signal, async () => {}));
  try {
    for (let index = 200; index >= 0; index--) await sorted.append({ name: String(index), localName: String(index), namespace: "", value: "é😀".repeat(40) });
    assert.ok(writes > 0, "records must spill to caller storage before sorting");
    const before = writes; inject = true;
    await assert.rejects(sorted.sort((a, b) => a.name.localeCompare(b.name)), error => error === failure);
    assert.ok(writes > before, "sorting must update backed links");
  } finally { inject = false; await storage.close(); }
  assert.equal(active, 0); assert.deepEqual(await fs.readdir("/"), []);
});
