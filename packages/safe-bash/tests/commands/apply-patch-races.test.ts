import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { createApplyPatchCommand } from "../../src/commands/apply-patch/index.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";
import type { FileSystem } from "../../src/contracts/index.js";

for (const [name, patch, method] of [
  ["update", "*** Update File: sub/target\n@@\n-old\n+new\n", "writeFile"],
  ["add", "*** Add File: sub/new\n+new\n", "writeFile"],
  ["delete", "*** Delete File: sub/target\n", "rm"],
  ["move destination", "*** Update File: target\n*** Move to: sub/new\n@@\n-old\n+new\n", "writeFile"],
  ["move source", "*** Update File: sub/target\n*** Move to: new\n@@\n-old\n+new\n", "rm"],
  ["parent creation", "*** Add File: sub/nested/new\n+new\n", "mkdir"],
] as const) {
  test(`apply_patch refuses ${name} ancestor swap at mutation`, async () => {
    const backing = createMemoryFileSystem();
    await backing.mkdir("/work/sub", { recursive: true });
    await backing.mkdir("/private");
    for (const path of ["/work/sub/target", "/work/target", "/private/target"]) await backing.writeFile(path, Buffer.from("old\n"));
    let swapped = false;
    const wrap = (fs: FileSystem): FileSystem => new Proxy(fs, {
      get(target, property) {
        const value: unknown = Reflect.get(target, property);
        if (property === "confineExtraction") return async (roots: readonly string[]) => wrap(await backing.confineExtraction!(roots));
        if (typeof value !== "function") return value;
        return async (...args: unknown[]) => {
          if ((property === method || property === (method === "writeFile" ? "writeFileConditional" : method === "rm" ? "removeFileConditional" : method)) && typeof args[0] === "string" && args[0].startsWith("/work/sub/") && !swapped) {
            swapped = true;
            await backing.rename("/work/sub", "/work/retired");
            await backing.symlink("/private", "/work/sub");
          }
          return Reflect.apply(value, target, args);
        };
      },
    });
    const shell = new Shell({ fs: wrap(backing), cwd: "/work" }).register(createApplyPatchCommand());
    try {
      const result = await shell.exec("apply_patch", { stdin: `*** Begin Patch\n${patch}*** End Patch\n` });
      assert.equal(swapped, true);
      assert.notEqual(result.exitCode, 0, result.stderr);
      assert.equal(Buffer.from(await backing.readFile("/private/target")).toString(), "old\n");
      assert.equal(Buffer.from(await backing.readFile("/work/retired/target")).toString(), "old\n");
      await assert.rejects(backing.lstat("/private/new"));
      await assert.rejects(backing.lstat("/private/nested"));
    } finally { await shell.dispose(); }
  });
}

test("apply_patch rejects backends without atomic confinement before mutation", async () => {
  const backing = createMemoryFileSystem();
  await backing.mkdir("/work");
  const fs = new Proxy(backing, { get(target, key) {
    if (key === "confineExtraction") return undefined;
    const value: unknown = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const shell = new Shell({ fs, cwd: "/work" }).register(createApplyPatchCommand());
  try {
    const result = await shell.exec("apply_patch", { stdin: "*** Begin Patch\n*** Add File: new\n+new\n*** End Patch\n" });
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /race-safe|not supported/);
    await assert.rejects(backing.lstat("/work/new"));
  } finally { await shell.dispose(); }
});

test("apply_patch supports add, update, move and delete within retained parents", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work");
  const shell = new Shell({ fs, cwd: "/work" }).register(createApplyPatchCommand());
  try {
    for (const patch of [
      "*** Add File: sub/target\n+old\n",
      "*** Update File: sub/target\n@@\n-old\n+new\n",
      "*** Update File: sub/target\n*** Move to: nested/moved\n@@\n-new\n+moved\n",
    ]) {
      const result = await shell.exec("apply_patch", { stdin: `*** Begin Patch\n${patch}*** End Patch\n` });
      assert.equal(result.exitCode, 0, result.stderr);
    }
    assert.equal(Buffer.from(await fs.readFile("/work/nested/moved")).toString(), "moved\n");
    await assert.rejects(fs.lstat("/work/sub/target"));
    const result = await shell.exec("apply_patch", { stdin: "*** Begin Patch\n*** Delete File: nested/moved\n*** End Patch\n" });
    assert.equal(result.exitCode, 0, result.stderr);
    await assert.rejects(fs.lstat("/work/nested/moved"));
  } finally { await shell.dispose(); }
});

test("apply_patch refuses a replaced destination identity at publication", async () => {
  const backing = createMemoryFileSystem();
  await backing.mkdir("/work");
  await backing.mkdir("/private");
  for (const path of ["/work/target", "/private/target"]) await backing.writeFile(path, Buffer.from("old\n"));
  let swapped = false;
  const wrap = (fs: FileSystem): FileSystem => new Proxy(fs, { get(target, key) {
    const value: unknown = Reflect.get(target, key);
    if (key === "confineExtraction") return async (roots: readonly string[]) => wrap(await backing.confineExtraction!(roots));
    if (typeof value !== "function") return value;
    return async (...args: unknown[]) => {
      if ((key === "writeFile" || key === "writeFileConditional") && args[0] === "/work/target" && !swapped) {
        swapped = true;
        await backing.rm("/work/target");
        await backing.link("/private/target", "/work/target");
      }
      return Reflect.apply(value, target, args);
    };
  } });
  const shell = new Shell({ fs: wrap(backing), cwd: "/work" }).register(createApplyPatchCommand());
  try {
    const result = await shell.exec("apply_patch", { stdin: "*** Begin Patch\n*** Update File: target\n@@\n-old\n+new\n*** End Patch\n" });
    assert.equal(swapped, true);
    assert.notEqual(result.exitCode, 0);
    assert.equal(Buffer.from(await backing.readFile("/private/target")).toString(), "old\n");
  } finally { await shell.dispose(); }
});
