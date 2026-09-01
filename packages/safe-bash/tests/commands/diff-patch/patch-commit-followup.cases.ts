import assert from "node:assert/strict";
import test from "node:test";
import { FsError, type FileSystem } from "../../../src/contracts/index.js";
import { contents, filesystem, replacement, run } from "./helpers.js";

for (const method of ["stat", "lstat", "readFile"] as const) {
  test(`followup ${method} failure between publications reports the committed prefix`, async () => {
    const backing = await filesystem({ first: "old\n", second: "old\n", third: "old\n" });
    const writes: string[] = [];
    const fs = new Proxy(backing, {
      get(target, key) {
        if (method === "readFile" && key === "readStream") return undefined;
        if (key === method) return async (path: string, ...args: unknown[]) => {
          if (writes.length && path === "/work/second") throw new FsError("EIO", { path });
          return Reflect.apply(target[method], target, [path, ...args]);
        };
        if (key === "writeFile") return async (path: string, ...args: unknown[]) => {
          writes.push(path);
          return Reflect.apply(target.writeFile, target, [path, ...args]);
        };
        const value: unknown = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as FileSystem;
    const result = await run("patch", [], { fs, input: ["first", "second", "third"].map(name => replacement.replaceAll("target", name)).join("") });
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /1\/3 files committed; failing operation may have side effects; path \/work\/second:.*EIO/u);
    assert.deepEqual(writes, ["/work/first"]);
    assert.equal(await contents(backing, "first"), "new\n");
    assert.equal(await contents(backing, "second"), "old\n");
    assert.equal(await contents(backing, "third"), "old\n");
  });
}
