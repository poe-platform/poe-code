import assert from "node:assert/strict";
import test from "node:test";
import type { FileStat } from "../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createReadOnlyFileSystem } from "../../../src/fs/readonly/index.js";
import { createFixture } from "./fixture.js";

for (const method of ["stat", "lstat"] as const) {
  for (const representation of ["enumerable-own", "nonenumerable-own", "prototype-accessor"] as const) {
    for (const reported of [undefined, 0, 1, 4096, Number.MAX_SAFE_INTEGER]) {
      test(`${method} forwards reported allocation ${reported} from ${representation}`, async () => {
        const fixture = createFixture();
        const source = { ...fixture.state[method] };
        let current = reported;
        let reads = 0;
        const owner = representation === "prototype-accessor" ? {} : source;
        Object.defineProperty(owner, "allocatedBytes", {
          enumerable: representation === "enumerable-own",
          get() {
            assert.equal(this, source);
            reads++;
            return current;
          },
        });
        if (owner !== source) Object.setPrototypeOf(source, owner);
        Object.defineProperty(source, "adapterState", {
          enumerable: true,
          get() { throw new Error("must not copy unrelated provider metadata"); },
        });
        Object.defineProperty(source, "blocks", { value: 91, enumerable: true });
        fixture.state[method] = source;
        const filesystem = createReadOnlyFileSystem(fixture.filesystem);
        const options = { signal: new AbortController().signal };
        const result = await filesystem[method]("/file", options);
        assert.equal(result.allocatedBytes, reported);
        assert.equal(Object.hasOwn(result, "allocatedBytes"), reported !== undefined);
        assert.equal(result.size, 4);
        assert.equal(result.type, source.type);
        assert.equal(Object.hasOwn(result, "adapterState"), false);
        assert.equal(Object.hasOwn(result, "blocks"), false);
        assert.equal(reads, 1);
        assert.deepEqual(fixture.calls, [{ method, args: ["/file", options] }]);
        if (reported !== undefined) {
          assert.deepEqual(Object.getOwnPropertyDescriptor(result, "allocatedBytes"), {
            value: reported, writable: true, enumerable: true, configurable: true,
          });
        }
        current = 8192;
        assert.equal(result.allocatedBytes, reported);
        assert.equal((await filesystem[method]("/file")).allocatedBytes, 8192);
      });
    }
  }

  test(`${method} propagates allocation accessor failures`, async () => {
    const fixture = createFixture();
    const failure = new Error("allocation metadata unavailable");
    Object.defineProperty(fixture.state[method], "allocatedBytes", { get() { throw failure; } });
    await assert.rejects(createReadOnlyFileSystem(fixture.filesystem)[method]("/file"), error => error === failure);
  });

  test(`${method} forwards a provider-reported directory allocation`, async () => {
    const fixture = createFixture();
    const directory: FileStat = { ...fixture.state[method], type: "directory", size: 0, allocatedBytes: 4096 };
    fixture.state[method] = directory;
    assert.deepEqual(await createReadOnlyFileSystem(fixture.filesystem)[method]("/directory"), directory);
  });
}

test("read-only memory views leave allocation unknown, including nonempty files", async () => {
  const memory = new MemoryFileSystem();
  await memory.writeFile("/file", new Uint8Array(8192));
  await memory.symlink("/file", "/link");
  const filesystem = createReadOnlyFileSystem(memory);
  for (const path of ["/", "/file", "/link"]) {
    for (const method of ["stat", "lstat"] as const) {
      const result = await filesystem[method](path);
      assert.equal(result.allocatedBytes, undefined);
      assert.equal(Object.hasOwn(result, "allocatedBytes"), false);
    }
  }
});
