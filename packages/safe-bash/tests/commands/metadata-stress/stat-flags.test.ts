import assert from "node:assert/strict";
import test from "node:test";
import * as host from "node:fs/promises";
import { join } from "node:path";
import { createRealFileSystem } from "../../../src/fs/real/index.js";
import { namespace, oracle, run } from "./helpers.js";

test("stat unsigned fields ignore sign flags while epoch fields retain them", async context => {
  const root = await namespace(context);
  await host.mkdir(join(root, "work"));
  await host.writeFile(join(root, "work/file"), "data");
  const fs = await createRealFileSystem({ root });
  for (const code of ["s", "a", "f", "i", "h", "u", "g", "d", "D", "X", "Y", "Z", "W"]) {
    const format = `[%+020${code}][% 20${code}][%-+20${code}]`;
    const native = oracle("stat", [`--printf=${format}`, "file"], join(root, "work"));
    const actual = await run("stat", [`--printf=${format}`, "file"], fs);
    assert.equal(native.exitCode, 0, native.stderr);
    assert.equal(actual.exitCode, 0, actual.stderr);
    assert.deepEqual(actual.stdout, native.stdout, format);
  }
});
