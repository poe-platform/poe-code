import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PagedStorage } from "@poe-code/safe-fs/storage";
import { XmlBudget, resolveXmlQueryLimits } from "./limits.js";
import { StoredStringMap as StoredNamespaces } from "./stored-map.js";

for (const order of [1, -1, 73]) test(`stored namespace scopes preserve ancestors and shadowing (order=${order})`, async () => {
  const fs = createMemoryFileSystem(), signal = new AbortController().signal;
  const storage = new PagedStorage({ fs, cwd: "/", env: {}, signal }, 1);
  const budget = new XmlBudget(resolveXmlQueryLimits(), signal, async () => {});
  let scope = new StoredNamespaces(storage, budget);
  const expected = new Map<string, string>();
  try {
    for (let index = 0; index < 180; index++) {
      const prefix = `p${String(order === -1 ? 179 - index : index * order % 181).padStart(3, "0")}`;
      expected.set(prefix, `urn:${index}`); scope = await scope.set(prefix, `urn:${index}`);
    }
    const original = scope;
    scope = await scope.set("", "urn:default");
    scope = await scope.set("p090", "urn:changed");
    scope = await scope.set("", "");
    assert.equal(await original.get(""), undefined);
    assert.equal(await original.get("p090"), expected.get("p090"));
    expected.set("p090", "urn:changed"); expected.set("", "");
    const actual = new Map<string, string>();
    for await (const [prefix, uri] of scope) { await Promise.resolve(); actual.set(prefix, uri); }
    assert.deepEqual(actual, expected);
    assert.equal(await scope.get("missing"), undefined);
    const restored = new StoredNamespaces(storage, budget, scope.reference);
    assert.equal(await restored.get("p090"), "urn:changed");
    for (const [prefix, uri] of expected) assert.equal(await restored.get(prefix), uri);
  } finally { await storage.close(); }
  assert.deepEqual(await fs.readdir("/"), []);
});

for (const cancel of [false, true]) test(`namespace updates preserve storage failures and ancestor state (cancel=${cancel})`, async () => {
  const fs = createMemoryFileSystem(), controller = new AbortController(), failure = new Error("namespace storage stopped");
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
  let scope = new StoredNamespaces(storage, new XmlBudget(resolveXmlQueryLimits(), controller.signal, async () => {}));
  try {
    for (let index = 0; index < 120; index++) scope = await scope.set(`p${index}`, `urn:${index}`);
    assert.ok(writes > 0, "scope state must reach caller storage");
    inject = true;
    await assert.rejects(scope.set("p0", "urn:changed"), error => error === failure);
    inject = false;
    if (!cancel) assert.equal(await scope.get("p0"), "urn:0");
  } finally { inject = false; await storage.close(); }
  assert.equal(active, 0); assert.deepEqual(await fs.readdir("/"), []);
});
