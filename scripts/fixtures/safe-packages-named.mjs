import assert from "node:assert/strict";
import { createRealm, defineExtension } from "@poe-platform/safe-js/core";

const attributes = new Map();
let titleValue = "original";
const extension = defineExtension({
  manifest: { version: 1, name: "named-collection", globals: ["attrs", "title"] },
  setup(context) {
    const title = context.createHostObject({ properties: { value: {
      get: () => titleValue,
      set: value => { assert.equal(typeof value, "string"); titleValue = value; }
    } } });
    attributes.set("title", title);
    attributes.set("hidden", context.createHostObject({ properties: { value: { get: () => "hidden" } } }));
    const attrs = context.createHostObject({
      named: { keys: () => [...attributes.keys()], get: name => attributes.get(name), maxKeys: 16, maxKeyCodeUnits: 128, enumerable: false },
      indexed: { length: () => attributes.size, get: index => [...attributes.values()][index], maxLength: 16 }
    });
    return { globals: { attrs, title } };
  }
});
const realm = createRealm({ extensions: [extension] });
try {
  const initial = await realm.evaluate(`
    const saved = attrs;
    const hidden = attrs.hidden;
    attrs.title.value = 'updated';
    return [attrs.title === title, attrs[0] === title, attrs.title.value,
      Object.keys(attrs), 'title' in attrs, Object.hasOwn(attrs, 'title'),
      Object.prototype.propertyIsEnumerable.call(attrs, 'title')];
  `);
  assert.equal(initial.ok, true);
  assert.deepEqual(initial.returnValue, [true, true, "updated", ["0", "1"], true, true, false]);
  assert.equal(titleValue, "updated");
  attributes.delete("title");
  const removed = await realm.evaluate("return [saved.title, 'title' in saved, saved[0] === hidden, Object.keys(saved)];");
  assert.equal(removed.ok, true);
  assert.deepEqual(removed.returnValue, [undefined, false, true, ["0"]]);
  await assert.rejects(realm.evaluate("saved.hidden = title;"), {
    name: "TypeError", message: "Host property 'hidden' is not writable."
  });
} finally {
  await realm.close();
}
await assert.rejects(realm.evaluate("saved.hidden;"));
let traps = 0;
const hostileKeys = new Proxy(["title"], {
  get() { traps++; throw new Error("Proxy get trap executed"); },
  ownKeys() { traps++; throw new Error("Proxy ownKeys trap executed"); },
  getOwnPropertyDescriptor() { traps++; throw new Error("Proxy descriptor trap executed"); }
});
const guarded = createRealm({ extensions: [defineExtension({
  manifest: { version: 1, name: "hostile-keys", globals: ["attrs"] },
  setup(context) { return { globals: { attrs: context.createHostObject({ named: {
    keys: () => hostileKeys, get: () => 1, maxKeys: 8, maxKeyCodeUnits: 128
  } }) } }; }
})] });
try {
  await assert.rejects(guarded.evaluate("attrs.title;"));
  assert.equal(traps, 0);
} finally {
  await guarded.close();
}
console.log("Public named collections preserve identity, removal, indexed composition and revocation");
