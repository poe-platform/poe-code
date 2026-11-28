import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs/core";
import { chunks, run } from "./helpers.js";

for (const existing of [false, true]) {
  test(`unzstd maps .tzst to .tar and ${existing ? "preserves an existing destination" : "removes the compressed source"}`, async () => {
    const fs = createMemoryFileSystem();
    await fs.mkdir("/work");
    await fs.writeFile("/work/a", Buffer.from("hi\n"));
    const context = { fs, cwd: "/work" };
    const encoded = await run("zstd", ["-q", "--rm", "a"], chunks(), context);
    assert.equal(encoded.exitCode, 0, encoded.stderr);
    await fs.rename("/work/a.zst", "/work/a.tzst");
    const compressed = await fs.readFile("/work/a.tzst");
    if (existing) await fs.writeFile("/work/a.tar", Buffer.from("keep me"));

    const decoded = await run("unzstd", ["-q", "--rm", "a.tzst"], chunks(), context);
    assert.equal(decoded.stdout.length, 0);
    if (existing) {
      assert.equal(decoded.exitCode, 1);
      assert.ok(decoded.stderr.includes("EEXIST"), decoded.stderr);
      assert.equal(Buffer.from(await fs.readFile("/work/a.tar")).toString(), "keep me");
      assert.deepEqual(await fs.readFile("/work/a.tzst"), compressed);
    } else {
      assert.equal(decoded.exitCode, 0, decoded.stderr);
      assert.equal(decoded.stderr, "");
      assert.equal(Buffer.from(await fs.readFile("/work/a.tar")).toString(), "hi\n");
      assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name), ["a.tar"]);
    }
  });
}
