import assert from "node:assert/strict";
import { test } from "node:test";
import type { TestContext } from "node:test";
import type { FileSystem } from "../../../src/contracts/filesystem.js";
import { collectBytes } from "../../../src/contracts/io.js";
import { adapters, binary, cancellation, errno, sourceState } from "./fixtures.js";

const initialState = await sourceState();
test("independent conformance source provenance", async (context) => {
  context.diagnostic(JSON.stringify({ sourceSha256: initialState }));
  context.after(async () => assert.deepEqual(await sourceState(), initialState, "sources changed during provenance check"));
});

type Check = (fs: FileSystem, context: TestContext) => Promise<void>;
const checks: Record<string, Check> = {
  "binary round trip preserves NUL, high bytes, and detached read copies": async (fs) => {
    const input = new Uint8Array(binary);
    await fs.writeFile("/bytes", input);
    input.fill(42);
    const read = await fs.readFile("/bytes");
    assert.deepEqual(read, binary);
    read.fill(43);
    assert.deepEqual(await fs.readFile("/bytes"), binary);
    assert.equal((await fs.stat("/bytes")).size, binary.length);
  },
  "write handles sliced typed arrays without leaking backing bytes": async (fs) => {
    await fs.writeFile("/slice", binary.subarray(251, 267));
    assert.deepEqual(await fs.readFile("/slice"), binary.slice(251, 267));
  },
  "overwrite truncates and zero-byte reads honor maxBytes zero": async (fs) => {
    await fs.writeFile("/bytes", binary);
    await fs.writeFile("/bytes", new Uint8Array());
    assert.deepEqual(await fs.readFile("/bytes", { maxBytes: 0 }), new Uint8Array());
    assert.equal((await fs.stat("/bytes")).size, 0);
  },
  "read maxBytes rejects overflow and accepts exact size": async (fs) => {
    await fs.writeFile("/bytes", binary);
    await assert.rejects(fs.readFile("/bytes", { maxBytes: binary.length - 1 }), errno("EFBIG"));
    assert.deepEqual(await fs.readFile("/bytes", { maxBytes: binary.length }), binary);
  },
  "mandatory appendFile creates and appends exact bytes": async (fs) => {
    await fs.appendFile("/append", binary.subarray(0, 513));
    await fs.appendFile("/append", binary.subarray(513));
    assert.deepEqual(await fs.readFile("/append"), binary);
  },
  "write flag a appends existing bytes": async (fs) => {
    await fs.writeFile("/append", binary.subarray(0, 513));
    await fs.writeFile("/append", binary.subarray(513), { flag: "a" });
    assert.deepEqual(await fs.readFile("/append"), binary);
  },
  "exclusive wx rejects existing files without modifying content": async (fs) => {
    await fs.writeFile("/exclusive", binary, { flag: "wx" });
    await assert.rejects(fs.writeFile("/exclusive", new Uint8Array([9]), { flag: "wx" }), errno("EEXIST"));
    assert.deepEqual(await fs.readFile("/exclusive"), binary);
  },
  "exclusive ax creates once without modifying existing content": async (fs) => {
    await fs.writeFile("/exclusive", binary, { flag: "ax" });
    await assert.rejects(fs.writeFile("/exclusive", new Uint8Array([9]), { flag: "ax" }), errno("EEXIST"));
    assert.deepEqual(await fs.readFile("/exclusive"), binary);
  },
  "missing read/stat/lstat/access/realpath preserve ENOENT": async (fs) => {
    for (const operation of [() => fs.readFile("/missing"), () => fs.stat("/missing"), () => fs.lstat("/missing"),
      () => fs.access("/missing"), () => fs.realpath("/missing")]) await assert.rejects(operation(), errno("ENOENT"));
  },
  "missing parents do not get created by writeFile": async (fs) => {
    await assert.rejects(fs.writeFile("/missing/child", binary), errno("ENOENT"));
    assert.deepEqual(await fs.readdir("/"), []);
  },
  "write through non-directory parent produces ENOTDIR and preserves bytes": async (fs) => {
    await fs.writeFile("/file", binary);
    await assert.rejects(fs.writeFile("/file/child", binary), errno("ENOTDIR"));
    assert.deepEqual(await fs.readFile("/file"), binary);
  },
  "read through non-directory parent produces ENOTDIR and preserves bytes": async (fs) => {
    await fs.writeFile("/file", binary);
    await assert.rejects(fs.readFile("/file/child"), errno("ENOTDIR"));
    assert.deepEqual(await fs.readFile("/file"), binary);
  },
  "readdir on a file produces ENOTDIR and preserves bytes": async (fs) => {
    await fs.writeFile("/file", binary);
    await assert.rejects(fs.readdir("/file"), errno("ENOTDIR"));
    assert.deepEqual(await fs.readFile("/file"), binary);
  },
  "reading and overwriting directories produce EISDIR": async (fs) => {
    await fs.mkdir("/dir");
    await assert.rejects(fs.readFile("/dir"), errno("EISDIR"));
    await assert.rejects(fs.writeFile("/dir", binary), errno("EISDIR"));
    assert.equal((await fs.stat("/dir")).type, "directory");
  },
  "trailing slash requires a directory, not lexical stripping": async (fs) => {
    await fs.writeFile("/file", binary);
    await assert.rejects(fs.readFile("/file/"), errno("ENOTDIR"));
    await assert.rejects(fs.stat("/file/"), errno("ENOTDIR"));
  },
  "recursive mkdir creates exactly one tree and is idempotent": async (fs) => {
    await fs.mkdir("/tree/child/leaf", { recursive: true });
    await fs.mkdir("/tree/child/leaf", { recursive: true });
    assert.deepEqual(await fs.readdir("/tree"), [{ name: "child", type: "directory" }]);
    await assert.rejects(fs.mkdir("/tree"), errno("EEXIST"));
    await assert.rejects(fs.mkdir("/missing/child"), errno("ENOENT"));
  },
  "nonrecursive directory removal fails closed on nonempty directories": async (fs, context) => {
    await fs.mkdir("/dir");
    await fs.writeFile("/dir/file", binary);
    await assert.rejects(fs.rm("/dir"), (error: unknown) => {
      errno("EISDIR", "ENOTEMPTY", "ENOTSUP")(error);
      context.diagnostic(`DIRECTORY POLICY: ${String(error)}`);
      return true;
    });
    assert.deepEqual(await fs.readFile("/dir/file"), binary);
  },
  "recursive directory removal removes an empty directory": async (fs) => {
    await fs.mkdir("/empty");
    await fs.rm("/empty", { recursive: true });
    await assert.rejects(fs.stat("/empty"), errno("ENOENT"));
  },
  "recursive rm preserves sibling-prefix names": async (fs) => {
    await fs.mkdir("/dir/sub", { recursive: true });
    await fs.writeFile("/dir/sub/file", binary);
    await fs.writeFile("/directory", binary);
    await fs.rm("/dir", { recursive: true });
    assert.deepEqual(await fs.readdir("/"), [{ name: "directory", type: "file" }]);
  },
  "force only suppresses absent paths": async (fs) => {
    await fs.rm("/missing", { force: true });
    await assert.rejects(fs.rm("/missing"), errno("ENOENT"));
    await assert.rejects(fs.rm("/bad\0path", { force: true }), errno("EINVAL"));
  },
  "file rename replaces destination and removes source": async (fs) => {
    await fs.writeFile("/source", binary);
    await fs.writeFile("/dest", new Uint8Array([8]));
    await fs.rename("/source", "/dest");
    assert.deepEqual(await fs.readFile("/dest"), binary);
    await assert.rejects(fs.stat("/source"), errno("ENOENT"));
  },
  "directory rename moves all descendants and preserves siblings": async (fs) => {
    await fs.mkdir("/tree/sub", { recursive: true });
    await fs.writeFile("/tree/sub/file", binary);
    await fs.writeFile("/tree-sibling", binary);
    await fs.rename("/tree", "/moved");
    assert.deepEqual(await fs.readFile("/moved/sub/file"), binary);
    assert.deepEqual(await fs.readFile("/tree-sibling"), binary);
    await assert.rejects(fs.stat("/tree"), errno("ENOENT"));
  },
  "rename onto self is a no-op; missing source still fails": async (fs) => {
    await fs.writeFile("/file", binary);
    await fs.rename("/file", "/file");
    assert.deepEqual(await fs.readFile("/file"), binary);
    await assert.rejects(fs.rename("/missing", "/missing"), errno("ENOENT"));
  },
  "rename cannot move a directory beneath itself": async (fs) => {
    await fs.mkdir("/tree/sub", { recursive: true });
    await assert.rejects(fs.rename("/tree", "/tree/sub/moved"), errno("EINVAL"));
    assert.equal((await fs.stat("/tree/sub")).type, "directory");
  },
  "rename file onto directory has EISDIR and preserves both": async (fs) => {
    await fs.mkdir("/dir");
    await fs.writeFile("/file", binary);
    await assert.rejects(fs.rename("/file", "/dir"), errno("EISDIR"));
    assert.deepEqual(await fs.readFile("/file"), binary);
    assert.equal((await fs.stat("/dir")).type, "directory");
  },
  "rename onto empty directory replaces it": async (fs) => {
    await fs.mkdir("/source");
    await fs.writeFile("/source/file", binary);
    await fs.mkdir("/dest");
    await fs.rename("/source", "/dest");
    assert.deepEqual(await fs.readFile("/dest/file"), binary);
    await assert.rejects(fs.stat("/source"), errno("ENOENT"));
  },
  "copyFile duplicates bytes, exclusive copy preserves destination": async (fs) => {
    await fs.writeFile("/source", binary);
    await fs.copyFile("/source", "/copy");
    await fs.writeFile("/source", new Uint8Array([17]));
    await assert.rejects(fs.copyFile("/source", "/copy", { exclusive: true }), errno("EEXIST"));
    assert.deepEqual(await fs.readFile("/copy"), binary);
  },
  "copyFile replaces an existing destination by default": async (fs) => {
    await fs.writeFile("/source", binary);
    await fs.writeFile("/copy", new Uint8Array([9]));
    await fs.copyFile("/source", "/copy");
    assert.deepEqual(await fs.readFile("/copy"), binary);
    assert.deepEqual(await fs.readFile("/source"), binary);
  },
  "copyFile refuses a directory source": async (fs) => {
    await fs.mkdir("/dir");
    await assert.rejects(fs.copyFile("/dir", "/copy"), errno("EISDIR", "ENOTSUP"));
    await assert.rejects(fs.stat("/copy"), errno("ENOENT"));
  },
  "Unicode and literal URL metacharacters round-trip": async (fs) => {
    for (const name of ["雪☃", "%2e%2e", "a%2fb", "hash#query?", "space & quote'\""]) {
      await fs.writeFile(`/${name}`, binary);
      assert.deepEqual(await fs.readFile(`/${name}`), binary);
    }
    assert.equal((await fs.readdir("/")).length, 5);
  },
  "NUL and non-string paths reject EINVAL without mutation": async (fs) => {
    for (const path of ["/bad\0name", null, 42, {}]) {
      await assert.rejects(fs.writeFile(path as string, binary), errno("EINVAL"));
    }
    assert.deepEqual(await fs.readdir("/"), []);
  },
  "malformed read limits reject EINVAL": async (fs) => {
    await fs.writeFile("/file", binary);
    for (const maxBytes of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      await assert.rejects(fs.readFile("/file", { maxBytes }), errno("EINVAL"));
    }
  },
  "malformed payload and flag reject EINVAL without data loss": async (fs) => {
    await fs.writeFile("/file", binary);
    await assert.rejects(fs.writeFile("/file", "text" as unknown as Uint8Array), (error: unknown) => error instanceof TypeError || errno("EINVAL")(error));
    await assert.rejects(fs.writeFile("/file", new Uint8Array(), { flag: "invalid" as "w" }), errno("EINVAL"));
    assert.deepEqual(await fs.readFile("/file"), binary);
  },
  "stat metadata is finite and type-consistent": async (fs) => {
    await fs.writeFile("/file", binary);
    const stat = await fs.stat("/file");
    assert.equal(stat.type, "file");
    assert.equal(stat.size, binary.length);
    for (const value of [stat.mode, stat.atimeMs, stat.mtimeMs, stat.ctimeMs]) assert.ok(Number.isFinite(value));
    assert.equal((await fs.lstat("/file")).type, "file");
    assert.equal(await fs.realpath("./file"), "/file");
  },
  "large directory lists every child exactly once": async (fs) => {
    await fs.mkdir("/listing");
    const names = Array.from({ length: 137 }, (_, index) => `file-${String(index).padStart(4, "0")}`);
    for (const name of names) await fs.writeFile(`/listing/${name}`, new Uint8Array([0, 128, 255]));
    await fs.mkdir("/listing/child");
    await fs.writeFile("/listing/child/hidden", binary);
    const entries = await fs.readdir("/listing");
    assert.deepEqual(entries.map((entry) => entry.name).sort(), [...names, "child"].sort());
    assert.equal(entries.filter((entry) => entry.type === "directory").length, 1);
    assert.equal(entries.filter((entry) => entry.type === "file").length, names.length);
  },
};

for (const adapter of adapters) {
  for (const [name, check] of Object.entries(checks)) {
    test(`${adapter.name}: shared ${name}`, { timeout: 20000 }, async (context) => {
      const { fs } = await adapter.create(context);
      await check(fs, context);
    });
  }
  for (const method of ["readFile", "stat", "lstat", "readdir", "realpath", "access", "writeFile", "mkdir", "rm", "rename", "copyFile"] as const) {
    test(`${adapter.name}: pre-aborted ${method} rejects cancellation without mutation`, async (context) => {
      const { fs } = await adapter.create(context);
      await fs.mkdir("/dir");
      await fs.writeFile("/file", binary);
      const signal = AbortSignal.abort(new Error("independent cancellation"));
      const operations = {
        readFile: () => fs.readFile("/file", { signal }), stat: () => fs.stat("/file", { signal }),
        lstat: () => fs.lstat("/file", { signal }), readdir: () => fs.readdir("/dir", { signal }),
        realpath: () => fs.realpath("/file", { signal }), access: () => fs.access("/file", 0, { signal }),
        writeFile: () => fs.writeFile("/file", new Uint8Array(), { signal }), mkdir: () => fs.mkdir("/new", { signal }),
        rm: () => fs.rm("/file", { signal }), rename: () => fs.rename("/file", "/renamed", { signal }),
        copyFile: () => fs.copyFile("/file", "/copied", { signal }),
      };
      await assert.rejects(operations[method](), cancellation(signal));
      assert.deepEqual(await fs.readFile("/file"), binary);
      assert.deepEqual((await fs.readdir("/")).map((entry) => entry.name).sort(), ["dir", "file"]);
    });
  }
  test(`${adapter.name}: symlinks follow capabilities, dangling links and cycles stay explicit`, async (context) => {
    const { fs } = await adapter.create(context);
    if (!fs.capabilities.symlinks) {
      assert.equal(fs.capabilities.symlinks, false);
      if (fs.symlink) await assert.rejects(fs.symlink("/target", "/link"), errno("ENOTSUP"));
      if (fs.readlink) await assert.rejects(fs.readlink("/link"), errno("ENOTSUP"));
      assert.deepEqual(await fs.readdir("/"), []);
      context.diagnostic("CAPABILITY GAP: symlinks=false; methods absent or reject ENOTSUP");
      return;
    }
    assert.ok(fs.symlink && fs.readlink);
    await fs.mkdir("/dir");
    await fs.writeFile("/dir/file", binary);
    await fs.symlink("dir/file", "/link");
    assert.equal(await fs.readlink("/link"), "dir/file");
    assert.equal((await fs.lstat("/link")).type, "symlink");
    assert.equal((await fs.stat("/link")).type, "file");
    assert.deepEqual(await fs.readFile("/link"), binary);
    assert.equal(await fs.realpath("/link"), "/dir/file");
    await fs.symlink("/missing", "/dangling");
    assert.equal((await fs.lstat("/dangling")).type, "symlink");
    await assert.rejects(fs.stat("/dangling"), errno("ENOENT"));
    await fs.symlink("/loop-b", "/loop-a");
    await fs.symlink("/loop-a", "/loop-b");
    await assert.rejects(fs.readFile("/loop-a"), errno("ELOOP"));
    await fs.rm("/link");
    assert.deepEqual(await fs.readFile("/dir/file"), binary);
  });
  test(`${adapter.name}: hardlink capabilities match inode-sharing or fail-closed behavior`, async (context) => {
    const { fs } = await adapter.create(context);
    await fs.writeFile("/file", binary);
    if (!fs.capabilities.hardlinks) {
      assert.equal(fs.capabilities.hardlinks, false);
      if (fs.link) await assert.rejects(fs.link("/file", "/alias"), errno("ENOTSUP"));
      await assert.rejects(fs.stat("/alias"), errno("ENOENT"));
      assert.deepEqual(await fs.readFile("/file"), binary);
      context.diagnostic("CAPABILITY GAP: hardlinks=false; link absent or rejects ENOTSUP");
      return;
    }
    assert.ok(fs.link);
    await fs.link("/file", "/alias");
    await fs.writeFile("/alias", new Uint8Array([255, 0]));
    assert.deepEqual(await fs.readFile("/file"), new Uint8Array([255, 0]));
    assert.equal((await fs.stat("/file")).ino, (await fs.stat("/alias")).ino);
  });
  test(`${adapter.name}: streaming capabilities match bounded reads or absent methods`, async (context) => {
    const { fs } = await adapter.create(context);
    await fs.writeFile("/file", binary);
    if (!fs.capabilities.streamingRead) {
      assert.equal(fs.capabilities.streamingRead, false);
      if (fs.readStream) await assert.rejects(collectBytes(fs.readStream("/file"), { maxBytes: binary.length }), errno("ENOTSUP"));
      else assert.equal(fs.readStream, undefined);
      assert.deepEqual(await fs.readFile("/file"), binary);
      context.diagnostic("CAPABILITY GAP: streamingRead=false; method absent or rejects ENOTSUP");
      return;
    }
    assert.ok(fs.readStream);
    assert.deepEqual(await collectBytes(fs.readStream("/file", { start: 253, endExclusive: 1027, chunkSize: 17 }), { maxBytes: 774 }), binary.slice(253, 1027));
  });
  test(`${adapter.name}: streaming write capability independently matches exact bytes or absent method`, async (context) => {
    const { fs } = await adapter.create(context);
    await fs.writeFile("/file", binary);
    const source = (async function* () { yield binary.subarray(0, 253); yield binary.subarray(253); })();
    if (!fs.capabilities.streamingWrite) {
      assert.equal(fs.capabilities.streamingWrite, false);
      if (fs.writeStream) await assert.rejects(fs.writeStream("/file", source), errno("ENOTSUP"));
      else assert.equal(fs.writeStream, undefined);
      assert.deepEqual(await fs.readFile("/file"), binary);
      context.diagnostic("CAPABILITY GAP: streamingWrite=false; method absent or rejects ENOTSUP");
      return;
    }
    assert.ok(fs.writeStream);
    await fs.writeStream("/streamed", source);
    assert.deepEqual(await fs.readFile("/streamed"), binary);
    await fs.writeStream("/streamed", (async function* () { yield binary.subarray(0, 3); })());
    assert.deepEqual(await fs.readFile("/streamed"), binary.slice(0, 3));
  });
}

test("conformance source state remained stable during suite", async () => {
  assert.deepEqual(await sourceState(), initialState, "source owner edited files during this run; rerun for stable evidence");
});
