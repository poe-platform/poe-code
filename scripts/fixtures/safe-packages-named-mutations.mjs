import assert from "node:assert/strict";

for (const entry of ["@poe-platform/safe-js", "@poe-platform/safe-js/core"]) {
  const { createRealm, defineExtension } = await import(entry);
  const values = new Map();
  const realm = createRealm({ extensions: [defineExtension({
    manifest: { version: 1, name: "writable-storage", globals: ["storage"] },
    setup(context) {
      return { globals: { storage: context.createHostObject({
        methods: { getItem: name => values.get(name) ?? null },
        named: {
          keys: () => [...values.keys()], get: name => values.get(name),
          set: (name, value) => { values.set(name, value); }, delete: name => values.delete(name),
          maxKeys: 2, maxKeyCodeUnits: 32
        }
      }) } };
    }
  })] });
  try {
    const initial = await realm.evaluate(`
      const saved = storage;
      const assigned = storage.theme = "dark";
      return [assigned, storage.getItem("theme"), Object.keys(storage), Object.hasOwn(storage, "theme")];
    `);
    assert.equal(initial.ok, true);
    assert.deepEqual(initial.returnValue, ["dark", "dark", ["getItem", "theme"], true]);
    values.set("native", 3);
    const next = await realm.evaluate(`
      let denied = 0;
      try { storage.extra = 1; } catch { denied++; }
      try { storage.getItem = 1; } catch { denied++; }
      return [saved === storage, saved.native, denied, delete saved.theme, delete saved.absent, saved.getItem("theme")];
    `);
    assert.equal(next.ok, true);
    assert.deepEqual(next.returnValue, [true, 3, 2, true, true, null]);
    assert.deepEqual([...values], [["native", 3]]);
    await realm.evaluate('storage.callback = () => { storage.native = 4; };');
  } finally { await realm.close(); }
  await assert.rejects(realm.invokeCallback(values.get("callback")), /closed/);
}
console.log("Public root/core named mutation, quotas, identity and revocation passed");
