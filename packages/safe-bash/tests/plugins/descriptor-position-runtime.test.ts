import assert from "node:assert/strict";
import { describe, test } from "node:test";

const selected = process.env.SAFE_BASH_TEST_OPTIONAL_BUILD;
if (selected !== undefined && selected !== "1") throw new Error("SAFE_BASH_TEST_OPTIONAL_BUILD must be 1 when supplied");

describe("public retained descriptor positions", { skip: selected === undefined ? "Requires a current public build and SAFE_BASH_TEST_OPTIONAL_BUILD=1" : false }, () => {
  test("public append cursor survives unrelated growth, truncation and unlink", async () => {
    const { createMemoryFileSystem } = await import("poe-code/safe-fs");
    const fs = createMemoryFileSystem();
    await fs.writeFile("/file", Buffer.from("abc"));
    const descriptor = await fs.open("/file", { access: "readwrite", append: true });
    try {
      assert.equal(descriptor.capabilities.position, true);
      assert.ok(descriptor.getPosition);
      assert.equal(await descriptor.getPosition(), 0);
      assert.equal(await descriptor.write(Buffer.from("X"), null), 1);
      assert.equal(await descriptor.getPosition(), 4);
      await fs.appendFile("/file", Buffer.from("YY"));
      assert.equal((await descriptor.stat()).size, 6);
      assert.equal(await descriptor.getPosition(), 4);
      await descriptor.read(new Uint8Array(1), 0);
      assert.equal(await descriptor.getPosition(), 4);
      await descriptor.truncate(2);
      await fs.rm("/file");
      assert.equal(await descriptor.getPosition(), 4);
      assert.equal((await descriptor.stat()).size, 2);
    } finally { await descriptor.close(); }
    await assert.rejects(descriptor.getPosition!(), { code: "EBADF" });
  });

  test("public mounted readonly descriptors preserve query support without mutation authority", async () => {
    const { createMemoryFileSystem, createMountFileSystem, createReadOnlyFileSystem } = await import("poe-code/safe-fs");
    const backing = createMemoryFileSystem();
    await backing.writeFile("/input", Buffer.from("abc"));
    const fs = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/readonly": createReadOnlyFileSystem(backing) } });
    const descriptor = await fs.open("/readonly/input", { access: "read" });
    try {
      assert.equal(descriptor.capabilities.position, true);
      assert.ok(descriptor.getPosition);
      await descriptor.read(new Uint8Array(2), null);
      assert.equal(await descriptor.getPosition(), 2);
      await assert.rejects(descriptor.write(Uint8Array.of(90), null), { code: "EBADF" });
      assert.equal(await descriptor.getPosition(), 2);
      const controller = new AbortController();
      controller.abort(false);
      await assert.rejects(descriptor.getPosition({ signal: controller.signal }), reason => reason === false);
      assert.equal(await descriptor.getPosition(), 2);
    } finally { await descriptor.close(); }
  });
});
