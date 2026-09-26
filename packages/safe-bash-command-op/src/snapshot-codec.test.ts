import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeSnapshot, decodeSnapshot } from "./snapshot-codec.js";

test("roundtrips binary leaves and user objects without interpreting their tags", () => {
  const seed = JSON.parse('{"vaults":[{"id":"vault","name":"Work","__proto__":{"polluted":true},"constructor":{"prototype":"ordinary"},"metadata":{"tag":"bytes","value":[0,255]}}]}');
  seed.documents = [{ id: "doc", content: new Uint8Array([0, 128, 255]), metadata: ["bytes", [1, 2]] }];
  seed.items = [{ id: "item", title: "Login", vault: "vault", files: [{ id: "file", name: "key", content: new Uint8Array() }] }];
  const restored = decodeSnapshot(encodeSnapshot(seed));
  assert.deepEqual(restored, seed);
  assert.equal(Object.hasOwn(restored.vaults![0]!, "__proto__"), true);
  assert.equal(Object.hasOwn(Object.prototype, "polluted"), false);
});

test("plain JSON seeds remain compatible and tag-shaped data stays ordinary", () => {
  const text = '{"documents":[{"id":"doc","metadata":["bytes",[255]],"content":{"type":"Uint8Array","data":[1,2]}}]}';
  assert.deepEqual(decodeSnapshot(text), JSON.parse(text));
});

test("rejects malformed envelopes and byte data instead of silently decoding", () => {
  for (const value of [null, [], ["@poe-platform/op/snapshot", 2, ["object", []]], ["@poe-platform/op/snapshot", 1, ["object", [["documents", ["bytes", [256]]]]]], ["@poe-platform/op/snapshot", 1, ["object", [["duplicate", ["value", 1]], ["duplicate", ["value", 2]]]]]]) {
    assert.throws(() => decodeSnapshot(JSON.stringify(value)));
  }
});

test("refuses unsupported state and cycles without emitting a corrupt snapshot", () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  for (const metadata of [cyclic, new Date(), new Map(), Infinity, () => {}]) {
    assert.throws(() => encodeSnapshot({ vaults: [{ id: "vault", name: "Work", metadata }] }));
  }
});

test("preserves envelope-shaped metadata, undefined, negative zero and null prototypes", () => {
  const metadata = Object.assign(Object.create(null), { marker: ["@poe-platform/op/snapshot", 1, ["bytes", [255]]], absent: undefined, number: -0 });
  const seed = { vaults: [{ id: "vault", name: "Work", metadata }] };
  assert.deepEqual(decodeSnapshot(encodeSnapshot(seed)), seed);
});

test("rejects extended and accessor arrays rather than dropping their properties", () => {
  const sparse = Object.assign(new Array(1), { extra: "preserve me" });
  const symbol = Object.assign([1], { [Symbol("key")]: "preserve me" });
  const accessor = Object.defineProperty([1], "0", { get() { assert.fail("must not evaluate accessor"); }, enumerable: true });
  const bytes = Object.assign(new Uint8Array([1]), { extra: "preserve me" });
  for (const metadata of [sparse, symbol, accessor, bytes]) {
    assert.throws(() => encodeSnapshot({ vaults: [{ id: "vault", name: "Work", metadata }] }), /Unsupported/);
  }
});
