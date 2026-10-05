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

for (const operation of ["lookup", "update", "key-lookup", "membership"]) test(`stored maps do not materialize unrelated large tokens during ${operation}`, async () => {
  const fs = createMemoryFileSystem(), signal = new AbortController().signal;
  const storage = new PagedStorage({ fs, cwd: "/", env: {}, signal }, 1);
  const budget = new XmlBudget(resolveXmlQueryLimits(), signal, async () => {});
  let readBytes = 0, appendedBytes = 0;
  const tracked = new Proxy(storage, { get(target, key) {
    if (key === "read") return async (offset: number, length: number) => { readBytes += length; return target.read(offset, length); };
    if (key === "append") return async (bytes: Uint8Array) => { appendedBytes += bytes.length; return target.append(bytes); };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  try {
    const key = operation === "key-lookup" ? "m".repeat(128 * 1024) : "m";
    const original = await new StoredNamespaces(tracked, budget).set(key, "v".repeat(128 * 1024));
    readBytes = 0; appendedBytes = 0;
    if (operation === "update") {
      const updated = await original.set("a", "new");
      assert.equal(await updated.get("a"), "new");
      assert.equal(await original.get("a"), undefined);
    } else if (operation === "membership") assert.notEqual(await original.lookup(key), undefined);
    else assert.equal(await original.get("a"), undefined);
    assert.ok(readBytes < 16 * 1024, `unrelated token reads: ${readBytes}`);
    assert.ok(appendedBytes < 4096, `unrelated token rewrites: ${appendedBytes}`);
  } finally { await storage.close(); }
  assert.deepEqual(await fs.readdir("/"), []);
});

test("stored map tokens preserve UTF-16 ordering, empty values and immutable replacements", async () => {
  const fs = createMemoryFileSystem(), signal = new AbortController().signal;
  const storage = new PagedStorage({ fs, cwd: "/", env: {}, signal }, 1);
  const budget = new XmlBudget(resolveXmlQueryLimits(), signal, async () => {});
  const keys = ["", "\u0000", "a", "a\u0000", "\ud800", "\ud800\udc00", "\udfff", "\uffff", "x".repeat(4095) + "😀", "x".repeat(4096) + "z"];
  let map = new StoredNamespaces(storage, budget);
  try {
    for (const key of keys) map = await map.set(key, key + "\u0000\ud800");
    const previous = map;
    map = await map.set("a", "");
    const same = await map.set("a", "");
    assert.equal(same.reference, map.reference);
    assert.equal(await previous.get("a"), "a\u0000\ud800");
    assert.equal(await map.get("a"), "");
    const actual: string[] = [];
    for await (const [key, value] of map) {
      actual.push(key);
      assert.equal(value, key === "a" ? "" : key + "\u0000\ud800");
    }
    assert.deepEqual(actual, [...keys].sort());
  } finally { await storage.close(); }
  assert.deepEqual(await fs.readdir("/"), []);
});

for (const fail of [false, true]) test(`stored map streams borrowed value chunks and retires producers (failure=${fail})`, async () => {
  const fs = createMemoryFileSystem(), signal = new AbortController().signal;
  const storage = new PagedStorage({ fs, cwd: "/", env: {}, signal }, 1);
  const budget = new XmlBudget(resolveXmlQueryLimits(), signal, async () => {}), failure = new Error("value stopped");
  const original = await new StoredNamespaces(storage, budget).set("p", "original");
  let closed = false;
  const piece = "x".repeat(4095) + "😀";
  const parts = (async function* () {
    try { for (let i = 0; i < 25; i++) { yield piece; if (fail && i === 2) throw failure; } }
    finally { closed = true; }
  })();
  try {
    const operation = original.set("p", parts);
    if (fail) await assert.rejects(operation, error => error === failure);
    else {
      const updated = await operation, reference = (await updated.lookup("p"))!;
      let actual = "";
      for await (const part of updated.valueParts(reference)) {
        assert.ok(part.length <= 4096);
        const last = part.charCodeAt(part.length - 1);
        assert.ok(last < 0xd800 || last > 0xdbff, "must not split surrogate pairs");
        actual += part; await Promise.resolve();
      }
      assert.equal(actual, piece.repeat(25));
      const shared = await updated.set("q", { reference });
      assert.equal(await shared.lookup("q"), reference);
      const copied = await shared.set("s", updated.valueParts(reference));
      assert.equal(await copied.equals((await copied.lookup("s"))!, reference), true);
      assert.equal(await copied.equals(reference, "other"), false);
    }
    assert.equal(await original.get("p"), "original"); assert.equal(closed, true);
  } finally { await storage.close(); }
  assert.deepEqual(await fs.readdir("/"), []);
});
