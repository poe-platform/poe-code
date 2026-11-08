import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PagedStorage, PagedStorageCache } from "@poe-code/safe-fs/storage";
import { DocumentStore, StoredSequence } from "./document-store.js";

async function fixture() {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/scratch");
  let reads = 0, writes = 0;
  const guarded = new Proxy(fs, { get(target, key) {
    if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole-file I/O"); };
    if (key === "open") return async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args);
      return new Proxy(handle, { get(target, key) {
        if (key === "read") return async (...args: Parameters<NonNullable<typeof handle.read>>) => {
          reads++; assert.ok(args[0].byteLength <= 16384);
          return handle.read!(...args);
        };
        if (key === "write") return async (...args: Parameters<NonNullable<typeof handle.write>>) => {
          writes++; assert.ok(args[0].byteLength <= 16384);
          return handle.write!(...args);
        };
        const value: unknown = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      } });
    };
    const value: unknown = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const cache = new PagedStorageCache(2);
  const storage = new PagedStorage({ fs: guarded, cwd: "/scratch", env: {}, signal: new AbortController().signal }, 2, cache);
  return { storage, tree: new DocumentStore(storage), fs, cache, io: () => ({ reads, writes }) };
}

async function children(tree: DocumentStore, parent: number) {
  const result: number[] = [];
  for await (const node of tree.children(parent)) result.push(node);
  return result;
}

test("stored DOM repairs both sibling directions when moving and detaching subtrees", async () => {
  const f = await fixture(), { tree } = f;
  try {
    const root = await tree.create("document"), a = await tree.create("element"), b = await tree.create("element"), c = await tree.create("text");
    await tree.attach(root, a); await tree.attach(root, b); await tree.attach(a, c);
    await tree.attach(root, c, b);
    assert.deepEqual(await children(tree, root), [a, c, b]);
    assert.deepEqual(await children(tree, a), []);
    assert.equal((await tree.read(a)).childCount, 0);
    assert.equal((await tree.read(root)).childCount, 3);
    assert.equal((await tree.read(c)).previous, a);
    assert.equal((await tree.read(c)).next, b);
    assert.equal((await tree.read(b)).previous, c);
    await tree.detach(a);
    await tree.attach(root, a);
    assert.deepEqual(await children(tree, root), [c, b, a]);
    await tree.detach(c); await tree.detach(b); await tree.detach(a);
    const empty = await tree.read(root);
    assert.equal(empty.first, 0); assert.equal(empty.last, 0); assert.equal(empty.childCount, 0);
    assert.equal((await tree.read(a)).parent, 0);
  } finally { await f.storage.close(); }
});

test("stored attribute clones preserve namespace/order without aliasing replacement links", async () => {
  const f = await fixture(), { tree } = f;
  try {
    const node = await tree.create("element", { namespace: "svg", name: 17 });
    await tree.attribute(node, 101, 201, "none");
    await tree.attribute(node, 102, 202, "xlink");
    const clone = await tree.clone(node);
    const entries = [];
    for await (const attribute of tree.attributes(clone)) entries.push(attribute);
    assert.deepEqual(entries.map(a => [a.name, a.value, a.namespace]), [[101, 201, "none"], [102, 202, "xlink"]]);
    await tree.replaceAttribute(entries[0]!.id, 999);
    const original = [];
    for await (const attribute of tree.attributes(node)) original.push(attribute.value);
    assert.deepEqual(original, [201, 202]);
    assert.equal((await tree.read(clone)).namespace, "svg");
    assert.equal((await tree.read(clone)).name, 17);
    assert.equal((await tree.read(clone)).parent, 0);
  } finally { await f.storage.close(); }
});

test("wide stored DOM spills through caller handles within the shared page bound", async () => {
  const f = await fixture(), { tree } = f;
  try {
    const root = await tree.create("document");
    for (let index = 0; index < 2048; index++) {
      const child = await tree.create("element", { name: index + 1 });
      await tree.attach(root, child);
      assert.ok(f.cache.residentBytes <= 32768);
      assert.ok(tree.residentNodes <= 512);
    }
    let count = 0;
    for await (const child of tree.children(root)) {
      assert.equal((await tree.read(child)).name, ++count);
      assert.ok(f.cache.residentBytes <= 32768);
      assert.ok(tree.residentNodes <= 512);
    }
    assert.equal(count, 2048);
    assert.ok(f.io().reads > 0); assert.ok(f.io().writes > 0);
  } finally { await f.storage.close(); }
  assert.deepEqual(await f.fs.readdir("/scratch"), []);
});

test("stored sequences support parser stack and adoption-agency edits across growth", async () => {
  const f = await fixture(), sequence = new StoredSequence(f.storage), expected: number[] = [];
  try {
    for (let index = 0; index < 5000; index++) { await sequence.push(index); expected.push(index); }
    await sequence.splice(0, 0, -1); expected.unshift(-1);
    await sequence.splice(sequence.length, 0, 99999); expected.push(99999);
    for (let index = 0; index < 40; index++) {
      const at = index * 71;
      await sequence.splice(at, 2, 9000 + index); expected.splice(at, 2, 9000 + index);
    }
    assert.equal(sequence.length, expected.length);
    assert.ok(sequence.residentBytes <= 16384);
    for (let index = 0; index < expected.length; index++) assert.equal(await sequence.get(index), expected[index]);
    assert.equal(await sequence.indexOf(9039), expected.indexOf(9039));
    assert.equal(await sequence.indexOf(-2), -1);
    await sequence.truncate(3); expected.length = 3;
    while (expected.length) assert.equal(await sequence.pop(), expected.pop());
    assert.equal(await sequence.pop(), undefined);
    assert.ok(f.cache.residentBytes <= 32768);
  } finally { await f.storage.close(); }
});
