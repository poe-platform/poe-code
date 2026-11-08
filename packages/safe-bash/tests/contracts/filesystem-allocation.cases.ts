import assert from "node:assert/strict";
import test from "node:test";
import type { FileStat, FileSystem } from "../../src/contracts/index.js";

type Same<Actual, Expected> =
  (<Value>() => Value extends Actual ? 1 : 2) extends
  (<Value>() => Value extends Expected ? 1 : 2) ? true : false;

const legacy = {
  type: "file" as const, size: 19, mode: 0o100644, atimeMs: 0, mtimeMs: 0, ctimeMs: 0,
};

test("allocatedBytes is an optional readonly number on the existing FileStat", () => {
  const shape: Same<Pick<FileStat, "allocatedBytes">, Readonly<{ allocatedBytes?: number }>> = true;
  const statResult: Same<Awaited<ReturnType<FileSystem["stat"]>>, FileStat> = true;
  const lstatResult: Same<Awaited<ReturnType<FileSystem["lstat"]>>, FileStat> = true;
  assert.equal(shape, true);
  assert.equal(statResult, true);
  assert.equal(lstatResult, true);
});

test("legacy stats and filesystem stat implementations need no allocation metadata", async () => {
  const filesystem: Pick<FileSystem, "stat" | "lstat"> = {
    stat: async () => legacy,
    lstat: async () => legacy,
  };
  for (const method of ["stat", "lstat"] as const) {
    const stat = await filesystem[method]("/file");
    assert.equal(stat.allocatedBytes, undefined);
    assert.equal(Object.hasOwn(stat, "allocatedBytes"), false);
    assert.equal(stat.size, 19);
  }
});

test("known zero and known allocation are distinct from absent unknown metadata", () => {
  for (const allocatedBytes of [0, 512, Number.MAX_SAFE_INTEGER]) {
    const stat: FileStat = { ...legacy, allocatedBytes };
    assert.equal(Object.hasOwn(stat, "allocatedBytes"), true);
    assert.equal(stat.allocatedBytes, allocatedBytes);
    assert.equal(stat.size, legacy.size);
  }
});
