import assert from "node:assert/strict";
import test from "node:test";
import type { DirectoryEntry, FileStat } from "../../../src/contracts/index.js";
import { createReadOnlyFileSystem } from "../../../src/fs/readonly/index.js";
import { createFixture } from "./fixture.js";

type Mutable<Value> = { -readonly [Key in keyof Value]: Value[Key] };
type Representation = "prototype-accessors" | "nonenumerable-own";

const optionalFields = ["allocatedBytes", "birthtimeMs", "ino", "dev", "nlink", "uid", "gid"] as const;

function metadata<Value extends object>(values: Value, representation: Representation) {
  class MetadataView {}
  const view = new MetadataView() as Value;
  const reads = new Map<keyof Value, number>();
  for (const key of Object.keys(values) as (keyof Value)[]) {
    if (representation === "prototype-accessors") {
      Object.defineProperty(MetadataView.prototype, key, {
        get() {
          assert.equal(this, view);
          reads.set(key, (reads.get(key) ?? 0) + 1);
          return values[key];
        },
      });
    } else {
      Object.defineProperty(view, key, { value: values[key], writable: true, enumerable: false });
    }
  }
  Object.defineProperty(view, "adapterState", { value: { mutable: true }, enumerable: true });
  return {
    view,
    reads,
    change<Key extends keyof Value>(key: Key, value: Value[Key]): void {
      values[key] = value;
      if (representation === "nonenumerable-own") assert.equal(Reflect.set(view, key, value), true);
    },
  };
}

function requiredStat(): Mutable<FileStat> {
  return { type: "file", size: 4, mode: 0o100755, mtimeMs: 11, atimeMs: 12, ctimeMs: 13 };
}

function fullStat(): Mutable<Required<FileStat>> {
  return { ...requiredStat(), allocatedBytes: 4096, birthtimeMs: 10, identityScope: Symbol(), ino: 21, dev: 22, nlink: 2, uid: 0, gid: 0 };
}

for (const representation of ["prototype-accessors", "nonenumerable-own"] as const) {
  for (const method of ["stat", "lstat"] as const) {
    test(`${method} snapshots all named fields from ${representation} without aliases`, async () => {
      const fixture = createFixture();
      const values = fullStat();
      const expected = { ...values };
      const delegate = metadata(values, representation);
      fixture.state[method] = delegate.view;
      const filesystem = createReadOnlyFileSystem(fixture.filesystem);
      const snapshot = await filesystem[method]("/file");
      assert.deepEqual(snapshot, expected);
      assert.equal(Object.getPrototypeOf(snapshot), Object.prototype);
      assert.equal(Object.hasOwn(snapshot, "adapterState"), false);
      for (const key of Object.keys(expected) as (keyof FileStat)[]) {
        const descriptor = Object.getOwnPropertyDescriptor(snapshot, key);
        assert.ok(descriptor);
        assert.equal(descriptor.get, undefined);
        assert.equal(descriptor.value, expected[key]);
        if (representation === "prototype-accessors") assert.equal(delegate.reads.get(key), 1);
      }
      delegate.change("type", "directory");
      delegate.change("size", 99);
      delegate.change("mode", 0);
      delegate.change("mtimeMs", 100);
      delegate.change("atimeMs", 101);
      delegate.change("ctimeMs", 102);
      for (const key of optionalFields) delegate.change(key, 103);
      delegate.change("identityScope", Symbol());
      assert.deepEqual(snapshot, expected);
      assert.deepEqual(await filesystem[method]("/file"), values);
      const mutable = snapshot as Mutable<FileStat>;
      mutable.mode = 0o777;
      mutable.ino = 999;
      assert.equal(delegate.view.mode, 0);
      assert.equal(delegate.view.ino, 103);
    });

    test(`${method} preserves optional absence for ${representation}`, async () => {
      const fixture = createFixture();
      const expected = requiredStat();
      fixture.state[method] = metadata(expected, representation).view;
      const snapshot = await createReadOnlyFileSystem(fixture.filesystem)[method]("/file");
      assert.deepEqual(snapshot, expected);
      for (const key of optionalFields) assert.equal(Object.hasOwn(snapshot, key), false);
    });

    test(`${method} preserves all ${2 ** optionalFields.length} optional-field permutations for ${representation}`, async () => {
      for (let mask = 0; mask < 2 ** optionalFields.length; mask++) {
        const fixture = createFixture();
        const expected = requiredStat();
        optionalFields.forEach((key, index) => {
          if ((mask & (1 << index)) !== 0) expected[key] = 0;
        });
        fixture.state[method] = metadata(expected, representation).view;
        const snapshot = await createReadOnlyFileSystem(fixture.filesystem)[method]("/file");
        assert.deepEqual(snapshot, expected);
        for (const key of optionalFields) {
          assert.equal(Object.hasOwn(snapshot, key), Object.hasOwn(expected, key));
        }
      }
    });
  }

  test(`readdir snapshots named fields from ${representation} without aliases`, async () => {
    const fixture = createFixture();
    const values: Mutable<DirectoryEntry> = { name: "file", type: "file" };
    const delegate = metadata(values, representation);
    fixture.state.entries = [delegate.view];
    const filesystem = createReadOnlyFileSystem(fixture.filesystem);
    const snapshots = await filesystem.readdir("/directory");
    assert.deepEqual(snapshots, [{ name: "file", type: "file" }]);
    const snapshot = snapshots[0]!;
    assert.equal(Object.getPrototypeOf(snapshot), Object.prototype);
    assert.equal(Object.hasOwn(snapshot, "adapterState"), false);
    for (const key of ["name", "type"] as const) {
      const descriptor = Object.getOwnPropertyDescriptor(snapshot, key);
      assert.ok(descriptor);
      assert.equal(descriptor.get, undefined);
      if (representation === "prototype-accessors") assert.equal(delegate.reads.get(key), 1);
    }
    delegate.change("name", "renamed");
    delegate.change("type", "symlink");
    assert.deepEqual(snapshot, { name: "file", type: "file" });
    assert.deepEqual(await filesystem.readdir("/directory"), [{ name: "renamed", type: "symlink" }]);
    (snapshot as Mutable<DirectoryEntry>).name = "local";
    snapshots.pop();
    assert.equal(delegate.view.name, "renamed");
    assert.equal(fixture.state.entries.length, 1);
  });
}
