import assert from "node:assert/strict";
import { createRealm, defineExtension } from "@poe-platform/safe-js/core";

const contents = [];
const reads = [];
const extension = defineExtension({
  manifest: { version: 1, name: "live-collection", globals: ["items", "first", "second", "trim"] },
  setup(context) {
    const first = context.createHostObject({ properties: { label: { get: () => "first" } } });
    const second = context.createHostObject({ properties: { label: { get: () => "second" } } });
    contents.push(first, second);
    const items = context.createHostObject({ indexed: {
      length: () => contents.length,
      get(index) { reads.push(index); return contents[index]; },
      maxLength: 16
    } });
    return { globals: { items, first, second, trim: () => { contents.length = 1; } } };
  }
});
const realm = createRealm({ extensions: [extension] });
try {
  const first = await realm.evaluate(`
    const saved = items;
    const values = Array.from(saved);
    const spread = { ...saved };
    const iterated = [...saved];
    return [saved.length, values[0] === first, spread[1] === second,
      iterated[0] === first, Object.keys(saved), '0' in saved, Object.hasOwn(saved, 'length')];
  `);
  assert.equal(first.ok, true);
  assert.deepEqual(first.returnValue, [2, true, true, true, ["0", "1"], true, true]);
  const mapped = await realm.evaluate("return Array.from(items, item => { trim(); return item.label; });");
  assert.equal(mapped.ok, true);
  assert.deepEqual(mapped.returnValue, ["first"]);
  contents.shift();
  const live = await realm.evaluate("return [saved.length, saved[0], Object.keys(saved)];");
  assert.deepEqual(live.returnValue, [0, undefined, []]);
  const count = reads.length;
  await realm.evaluate("saved['01']; saved[-1]; saved[999];");
  assert.equal(reads.length, count);
} finally {
  await realm.close();
}
await assert.rejects(realm.evaluate("saved[0];"), /closed/);
console.log("Public indexed collections preserve liveness, identity, iteration and revocation");
