import assert from "node:assert/strict";
import * as native from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { FsError, type FileSystem, type FsOptions, type RemoveOptions } from "../../src/contracts/index.js";
import { createRealFileSystem } from "../../src/fs/real/index.js";
import { standardCommands } from "../../src/commands/index.js";
import { Shell } from "../../src/shell/index.js";
import { run } from "./helpers.js";

interface RemovalHooks {
  absent?: boolean;
  beforeRemove?: (path: string, options: FsOptions) => Promise<void>;
  afterList?: (path: string) => Promise<void>;
}

async function harness(context: TestContext, hooks: RemovalHooks = {}) {
  const root = await native.realpath(await native.mkdtemp(join(tmpdir(), "safe-bash-rmdir-")));
  context.after(() => native.rm(root, { recursive: true, force: true }));
  const backing = await createRealFileSystem({ root });
  await backing.mkdir("/work");
  const removals: { path: string; options: FsOptions }[] = [];
  const ordinary: { path: string; options: RemoveOptions | undefined }[] = [];
  const listings: string[] = [];
  const filesystem: FileSystem = new Proxy(backing, {
    get(target, property) {
      if (property === "rmdir") return hooks.absent ? undefined : async function(this: FileSystem, path: string, options: FsOptions = {}) {
        assert.equal(this, filesystem);
        removals.push({ path, options });
        options.signal?.throwIfAborted();
        await hooks.beforeRemove?.(path, options);
        options.signal?.throwIfAborted();
        await native.rmdir(`${root}${path}`);
      };
      if (property === "rm") return async (path: string, options?: RemoveOptions) => {
        ordinary.push({ path, options });
        return target.rm(path, options);
      };
      if (property === "readdir") return async (path: string, options?: FsOptions) => {
        listings.push(path);
        const entries = await target.readdir(path, options);
        await hooks.afterList?.(path);
        return entries;
      };
      const member: unknown = Reflect.get(target, property, target);
      return typeof member === "function" ? member.bind(target) : member;
    },
  });
  return { fs: filesystem, backing, root, removals, ordinary, listings };
}

const consumers = [
  { command: "rmdir", flags: [] },
  { command: "rm", flags: ["-d"] },
] as const;

for (const { command, flags } of consumers) {
  test(`${command} empty-directory removal rejects missing capability without fallback`, async context => {
    const observed = await harness(context, { absent: true });
    await observed.backing.mkdir("/work/empty");
    const result = await run(command, [...flags, "empty"], { fs: observed.fs });
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /ENOTSUP/u);
    assert.equal((await observed.backing.stat("/work/empty")).type, "directory");
    assert.deepEqual(observed.ordinary, []);
    assert.deepEqual(observed.listings, []);
  });

  test(`${command} uses native nonrecursive removal with the original signal`, async context => {
    const observed = await harness(context);
    const signal = new AbortController().signal;
    await observed.backing.mkdir("/work/empty");
    const result = await run(command, [...flags, "empty"], { fs: observed.fs, signal });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(observed.removals, [{ path: "/work/empty", options: { signal } }]);
    assert.deepEqual(observed.ordinary, []);
    assert.deepEqual(observed.listings, []);
    await assert.rejects(observed.backing.stat("/work/empty"), { code: "ENOENT" });
  });

  test(`${command} preserves a child inserted after an empty observation`, async context => {
    let inserted = false;
    const observed = await harness(context, {
      beforeRemove: insert,
      afterList: insert,
    });
    async function insert(path: string) {
      if (path !== "/work/empty" || inserted) return;
      inserted = true;
      await observed.backing.writeFile("/work/empty/concurrent-child", Uint8Array.of(0, 255, 13, 10));
    }
    await observed.backing.mkdir("/work/empty");
    assert.deepEqual(await observed.backing.readdir("/work/empty"), []);
    const result = await run(command, [...flags, "empty"], { fs: observed.fs });
    assert.equal(inserted, true);
    assert.equal(result.exitCode, 1, "must not recursively delete the newly inserted child");
    assert.match(result.stderr, /ENOTEMPTY/u);
    assert.deepEqual(await observed.backing.readFile("/work/empty/concurrent-child"), Uint8Array.of(0, 255, 13, 10));
    assert.deepEqual(observed.ordinary, []);
    assert.equal(observed.removals.length, 1);
  });

  for (const code of ["ENOTSUP", "EACCES", "EROFS", "EIO", "ENOTEMPTY"] as const) {
    test(`${command} preserves ${code} and directory contents without a fallback`, async context => {
      const observed = await harness(context, {
        async beforeRemove(path) { throw new FsError(code, { syscall: "rmdir", path }); },
      });
      await observed.backing.mkdir("/work/empty");
      const result = await run(command, [...flags, "empty"], { fs: observed.fs });
      assert.equal(result.exitCode, 1);
      assert.match(result.stderr, new RegExp(code, "u"));
      assert.equal((await observed.backing.stat("/work/empty")).type, "directory");
      assert.deepEqual(observed.ordinary, []);
    });
  }

  test(`${command} rejects pre-aborted removal without entering the filesystem`, async context => {
    const observed = await harness(context);
    await observed.backing.mkdir("/work/empty");
    const controller = new AbortController();
    const reason = new Error("pre-aborted directory removal");
    controller.abort(reason);
    await assert.rejects(run(command, [...flags, "empty"], { fs: observed.fs, signal: controller.signal }), error => error === reason);
    assert.deepEqual(observed.removals, []);
    assert.deepEqual(observed.ordinary, []);
    assert.equal((await observed.backing.stat("/work/empty")).type, "directory");
  });

  test(`${command} propagates cancellation during removal without deleting`, async context => {
    const controller = new AbortController();
    const reason = new Error("cancel in directory operation");
    const observed = await harness(context, {
      async beforeRemove(_path, options) {
        assert.equal(options.signal, controller.signal);
        controller.abort(reason);
      },
    });
    await observed.backing.mkdir("/work/empty");
    await assert.rejects(run(command, [...flags, "empty"], { fs: observed.fs, signal: controller.signal }), error => error === reason);
    assert.equal((await observed.backing.stat("/work/empty")).type, "directory");
    assert.deepEqual(observed.ordinary, []);
  });

  for (const name of ["-leading", "a b", "a\nb", "$(touch injected);*?[x]", "quote'\\é"]) {
    test(`${command} treats ${JSON.stringify(name)} as a literal directory operand`, async context => {
      const observed = await harness(context);
      await observed.backing.mkdir(`/work/${name}`);
      const result = await run(command, [...flags, "--", name], { fs: observed.fs });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(observed.removals[0]?.path, `/work/${name}`);
      assert.deepEqual(await observed.backing.readdir("/work"), []);
      assert.deepEqual(observed.ordinary, []);
    });
  }

  test(`${command} retains a nonempty directory and reports native error`, async context => {
    const observed = await harness(context);
    await observed.backing.mkdir("/work/parent");
    await observed.backing.writeFile("/work/parent/child", Uint8Array.of(1));
    const result = await run(command, [...flags, "parent"], { fs: observed.fs });
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /ENOTEMPTY/u);
    assert.deepEqual(await observed.backing.readFile("/work/parent/child"), Uint8Array.of(1));
    assert.deepEqual(observed.ordinary, []);
  });

  test(`${command} rejects a file substituted for the directory at removal`, async context => {
    const observed = await harness(context, {
      async beforeRemove(path) {
        await observed.backing.rename(path, "/work/original");
        await observed.backing.writeFile(path, Uint8Array.of(0, 255));
      },
    });
    await observed.backing.mkdir("/work/empty");
    const result = await run(command, [...flags, "empty"], { fs: observed.fs });
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /ENOTDIR/u);
    assert.deepEqual(await observed.backing.readFile("/work/empty"), Uint8Array.of(0, 255));
    assert.equal((await observed.backing.stat("/work/original")).type, "directory");
    assert.deepEqual(observed.ordinary, []);
  });

  test(`${command} preserves filesystem traversal errors rather than normalizing them away`, async context => {
    const observed = await harness(context);
    await observed.backing.mkdir("/work/kept");
    await observed.backing.writeFile("/work/file", Uint8Array.of(5));
    for (const [path, code] of [["missing/../kept", "ENOENT"], ["file/../kept", "ENOTDIR"]]) {
      const result = await run(command, [...flags, path!], { fs: observed.fs });
      assert.equal(result.exitCode, 1);
      assert.match(result.stderr, new RegExp(code!, "u"));
      assert.equal((await observed.backing.stat("/work/kept")).type, "directory");
    }
    assert.deepEqual(observed.ordinary, []);
  });

  test(`${command} leaves symlink-parent dot traversal to the filesystem`, async context => {
    const observed = await harness(context);
    await observed.backing.mkdir("/work/parent/child", { recursive: true });
    await observed.backing.mkdir("/work/parent/victim");
    await observed.backing.mkdir("/work/victim");
    await observed.backing.symlink!("parent/child", "/work/link");
    const result = await run(command, [...flags, "link/../victim"], { fs: observed.fs });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(observed.removals[0]?.path, "/work/link/../victim");
    await assert.rejects(observed.backing.stat("/work/parent/victim"), { code: "ENOENT" });
    assert.equal((await observed.backing.stat("/work/victim")).type, "directory");
    assert.equal((await observed.backing.lstat("/work/link")).type, "symlink");
  });

  test(`${command} protects root and rejects invalid operands without removal`, async context => {
    const observed = await harness(context);
    for (const path of ["/", "", "bad\0path"]) {
      assert.equal((await run(command, [...flags, "--", path], { fs: observed.fs })).exitCode, 1);
    }
    assert.deepEqual(observed.removals, []);
    assert.deepEqual(observed.ordinary, []);
  });
}

test("rmdir never unlinks a final symlink or file and reports missing paths", async context => {
  const observed = await harness(context);
  await observed.backing.mkdir("/work/directory");
  await observed.backing.writeFile("/work/file", Uint8Array.of(9));
  await observed.backing.symlink!("directory", "/work/link");
  for (const path of ["file", "link"]) {
    const result = await run("rmdir", [path], { fs: observed.fs });
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /ENOTDIR/u);
  }
  assert.match((await run("rmdir", ["missing"], { fs: observed.fs })).stderr, /ENOENT/u);
  assert.equal((await observed.backing.lstat("/work/link")).type, "symlink");
  assert.deepEqual(await observed.backing.readFile("/work/file"), Uint8Array.of(9));
  assert.deepEqual(observed.ordinary, []);
});

test("rmdir -p removes only empty parents and stops before a concurrent sibling", async context => {
  const observed = await harness(context, {
    async beforeRemove(path) {
      if (path === "/work/parent") await observed.backing.writeFile("/work/parent/sibling", Uint8Array.of(7));
    },
  });
  await observed.backing.mkdir("/work/parent/child", { recursive: true });
  const result = await run("rmdir", ["-p", "parent/child"], { fs: observed.fs });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /ENOTEMPTY/u);
  assert.deepEqual(observed.removals.map(entry => entry.path), ["/work/parent/child", "/work/parent"]);
  await assert.rejects(observed.backing.stat("/work/parent/child"), { code: "ENOENT" });
  assert.deepEqual(await observed.backing.readFile("/work/parent/sibling"), Uint8Array.of(7));
  assert.deepEqual(observed.ordinary, []);
});

test("rmdir -pv uses directory-only removal for each parent and preserves cwd", async context => {
  const observed = await harness(context);
  await observed.backing.mkdir("/work/parent/child", { recursive: true });
  const result = await run("rmdir", ["-pv", "parent/child"], { fs: observed.fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "rmdir: removing directory '/work/parent/child'\nrmdir: removing directory '/work/parent'\n");
  assert.deepEqual(observed.removals.map(entry => entry.path), ["/work/parent/child", "/work/parent"]);
  assert.equal((await observed.backing.stat("/work")).type, "directory");
});

test("rm -d retains ordinary file, symlink, force and explicit recursive semantics", async context => {
  const observed = await harness(context, { absent: true });
  await observed.backing.mkdir("/work/tree");
  await observed.backing.writeFile("/work/tree/file", Uint8Array.of(2));
  await observed.backing.writeFile("/work/file", Uint8Array.of(3));
  await observed.backing.symlink!("tree", "/work/link");
  assert.equal((await run("rm", ["-d", "file", "link"], { fs: observed.fs })).exitCode, 0);
  assert.deepEqual(await observed.backing.readFile("/work/tree/file"), Uint8Array.of(2));
  assert.equal((await run("rm", ["-df", "missing"], { fs: observed.fs })).exitCode, 0);
  assert.equal((await run("rm", ["-dr", "tree"], { fs: observed.fs })).exitCode, 0);
  assert.deepEqual(observed.ordinary.map(entry => [entry.path, entry.options?.recursive]), [
    ["/work/file", false], ["/work/link", false], ["/work/tree", true],
  ]);
  assert.deepEqual(observed.removals, []);
});

for (const code of ["ENOENT", "ENOTDIR", "ENOTEMPTY", "ENOTSUP", "EACCES"] as const) {
  test(`rm -df suppresses only missing paths, not ${code} capability/type errors`, async context => {
    const observed = await harness(context, {
      async beforeRemove(path) { throw new FsError(code, { syscall: "rmdir", path }); },
    });
    await observed.backing.mkdir("/work/empty");
    const result = await run("rm", ["-df", "empty"], { fs: observed.fs });
    assert.equal(result.exitCode, code === "ENOENT" ? 0 : 1);
    if (code !== "ENOENT") assert.match(result.stderr, new RegExp(code, "u"));
    assert.equal((await observed.backing.stat("/work/empty")).type, "directory");
    assert.deepEqual(observed.ordinary, []);
  });
}

test("shell quoted directory operands use the optional primitive without evaluation", async context => {
  const observed = await harness(context);
  const name = "$(touch injected); *?";
  await observed.backing.mkdir(`/work/${name}`);
  const shell = new Shell({ fs: observed.fs, cwd: "/work" }).use(standardCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec(`rmdir -- '${name}'; printf done`);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "done");
  assert.equal(observed.removals[0]?.path, `/work/${name}`);
  assert.deepEqual(await observed.backing.readdir("/work"), []);
});

test("rm -df does not suppress an ENOENT-shaped cancellation reason", async context => {
  const controller = new AbortController();
  const reason = new FsError("ENOENT", { message: "caller cancelled with an errno-shaped reason" });
  const observed = await harness(context, {
    async beforeRemove() { controller.abort(reason); },
  });
  await observed.backing.mkdir("/work/empty");
  await assert.rejects(run("rm", ["-df", "empty"], { fs: observed.fs, signal: controller.signal }), error => error === reason);
  assert.equal((await observed.backing.stat("/work/empty")).type, "directory");
  assert.deepEqual(observed.ordinary, []);
});

test("rm -df reports absent capability even with force", async context => {
  const observed = await harness(context, { absent: true });
  await observed.backing.mkdir("/work/empty");
  const result = await run("rm", ["-df", "empty"], { fs: observed.fs });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /ENOTSUP/u);
  assert.equal((await observed.backing.stat("/work/empty")).type, "directory");
  assert.deepEqual(observed.ordinary, []);
});

test("rm -df tolerates actual concurrent disappearance, without recursive fallback", async context => {
  const observed = await harness(context, {
    async beforeRemove(path) { await native.rmdir(`${observed.root}${path}`); },
  });
  await observed.backing.mkdir("/work/empty");
  const result = await run("rm", ["-df", "empty"], { fs: observed.fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  await assert.rejects(observed.backing.stat("/work/empty"), { code: "ENOENT" });
  assert.deepEqual(observed.ordinary, []);
});
