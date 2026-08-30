import assert from "node:assert/strict";
import test from "node:test";
import { FsError } from "../../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createMountFileSystem } from "../../../src/fs/mount/index.js";
import { bytes, command, effects, payload, previous, provider, unchanged, unscoped, view } from "./helpers.js";

for (const partial of [false, true]) test(`mv: failed publication preserves source; partial=${partial}`, async () => {
  const { base, fs, events } = await provider();
  const observed = view(fs, {
    compareEntry: async () => "distinct",
    copyFile: async (_source, target) => {
      assert.deepEqual(await bytes(base, "/source"), payload);
      if (partial) await base.writeFile(target, payload.subarray(0, 3));
      throw new FsError("EIO", { message: "publication failed" });
    },
  });
  const result = await command("mv", ["/source", "/target"], observed);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /EIO.*publication failed/u);
  assert.deepEqual(effects(events), []);
  assert.deepEqual(await bytes(base, "/source"), payload);
  assert.deepEqual(await bytes(base, "/target"), partial ? payload.subarray(0, 3) : previous);
});

for (const phase of ["copy", "metadata", "remove"] as const) test(`mv: cancellation at ${phase} never deletes source`, async () => {
  const { base, fs, events } = await provider({ scoped: true });
  const controller = new AbortController(), reason = new FsError("EACCES", { message: "caller canceled" });
  const observed = view(fs, {
    copyFile: async (source, target, controls) => {
      await base.copyFile(source, target, controls);
      if (phase === "copy") controller.abort(reason);
    },
    chmod: async (path, mode, controls) => {
      await base.chmod(path, mode, controls);
      if (phase === "metadata") controller.abort(reason);
    },
    rm: async (_path, controls) => {
      assert.equal(phase, "remove");
      controller.abort(reason);
      controls?.signal?.throwIfAborted();
      throw new Error("unreachable mutation");
    },
  });
  await assert.rejects(command("mv", ["/source", "/target"], observed, controller.signal), error => error === reason);
  assert.deepEqual(effects(events), []);
  assert.deepEqual(await bytes(base, "/source"), payload);
  assert.deepEqual(await bytes(base, "/target"), payload);
});

for (const noClobber of [false, true]) test(`mv: raced destination requires exclusive creation; noClobber=${noClobber}`, async () => {
  const { base, fs, events } = await provider({ target: false });
  const observed = view(fs, { copyFile: async (source, target, controls) => {
    assert.equal(controls?.exclusive, true);
    await base.writeFile(target, previous);
    await base.copyFile(source, target, controls);
  } });
  const result = await command("mv", [...(noClobber ? ["-n"] : []), "/source", "/target"], observed);
  assert.equal(result.exitCode, noClobber ? 0 : 1);
  if (!noClobber) assert.match(result.stderr, /EEXIST/u);
  assert.deepEqual(effects(events), []);
  await unchanged(base);
});

test("mv: all directory publications precede cleanup; a later copy failure keeps every source", async () => {
  const base = createMemoryFileSystem();
  await base.mkdir("/source");
  await base.writeFile("/source/first", payload);
  await base.writeFile("/source/second", previous);
  const removals: string[] = [];
  const fs = view(base, {
    rename: async () => { throw new FsError("EXDEV"); },
    copyFile: async (source, target, controls) => {
      assert.deepEqual(await bytes(base, "/source/first"), payload);
      if (source.endsWith("second")) throw new FsError("ENOSPC");
      await base.copyFile(source, target, controls);
    },
    rm: async path => { removals.push(path); },
    rmdir: async path => { removals.push(path); },
  });
  const result = await command("mv", ["/source", "/target"], fs);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /ENOSPC/u);
  assert.deepEqual(removals, []);
  assert.deepEqual(await bytes(base, "/source/first"), payload);
  assert.deepEqual(await bytes(base, "/source/second"), previous);
  assert.deepEqual(await bytes(base, "/target/first"), payload);
});

test("mv: depth budget rejects before any publication or recursive cleanup", async () => {
  const base = createMemoryFileSystem();
  await base.mkdir("/source");
  let leaf = "/source";
  for (let depth = 0; depth < 130; depth++) { leaf += "/child"; await base.mkdir(leaf); }
  await base.writeFile(`${leaf}/data`, payload);
  const mutations: string[] = [];
  const fs = view(base, {
    rename: async () => { throw new FsError("EXDEV"); },
    mkdir: async path => { mutations.push(path); },
    rm: async path => { mutations.push(path); },
    rmdir: async path => { mutations.push(path); },
  });
  const result = await command("mv", ["/source", "/target"], fs);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /EFBIG.*depth limit/u);
  assert.deepEqual(mutations, []);
  assert.deepEqual(await bytes(base, `${leaf}/data`), payload);
});

test("cp -P: an unscoped final symlink alias must not be unlinked", async () => {
  const base = createMemoryFileSystem();
  await base.writeFile("/referent", payload);
  await base.symlink("referent", "/source");
  const naked = view(base, {
    stat: async (path, controls) => unscoped(await base.stat(path, controls)),
    lstat: async (path, controls) => unscoped(await base.lstat(path, controls)),
  });
  const mounted = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/left": naked, "/right": naked } });
  const removals: string[] = [];
  const fs = view(mounted, { rm: async (path, controls) => { removals.push(path); await mounted.rm(path, controls); } });
  const result = await command("cp", ["-P", "/left/source", "/right/source"], fs);
  assert.equal(result.exitCode, 1);
  assert.deepEqual(removals, [], "followed comparison cannot authorize deleting an unknown final symlink entry");
  assert.equal(await base.readlink("/source"), "referent");
  assert.deepEqual(await bytes(base, "/referent"), payload);
});

test("cp -P: unknown distinct symlinks fail closed without trusting followed distinctness", async () => {
  const { base, fs, events } = await provider();
  await base.symlink("source", "/source-link");
  await base.symlink("target", "/target-link");
  let comparisons = 0;
  const result = await command("cp", ["-P", "/source-link", "/target-link"], view(fs, {
    compareEntry: async () => { comparisons++; return "distinct"; },
  }));
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /ENOTSUP.*authoritative distinctness/u);
  assert.equal(comparisons, 0);
  assert.deepEqual(effects(events), []);
  assert.equal(await base.readlink("/source-link"), "source");
  assert.equal(await base.readlink("/target-link"), "target");
  await unchanged(base);
});

test("cp -P: known distinct symlinks retain legitimate replacement", async () => {
  const { base, fs } = await provider({ scoped: true });
  await base.symlink("source", "/source-link");
  await base.symlink("target", "/target-link");
  const result = await command("cp", ["-P", "/source-link", "/target-link"], fs);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(await base.readlink("/source-link"), "source");
  assert.equal(await base.readlink("/target-link"), "source");
  await unchanged(base);
});

test("cp -P: readlink failure precedes destination unlink", async () => {
  const { base, fs, events } = await provider({ scoped: true });
  await base.symlink("source", "/source-link");
  await base.symlink("target", "/target-link");
  const observed = view(fs, { readlink: async () => { throw new FsError("EIO", { syscall: "readlink" }); } });
  const result = await command("cp", ["-P", "/source-link", "/target-link"], observed);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /EIO.*readlink/u);
  assert.deepEqual(effects(events), []);
  assert.equal(await base.readlink("/source-link"), "source");
  assert.equal(await base.readlink("/target-link"), "target");
  await unchanged(base);
});

test("cp -P: unscoped source still copies to a missing destination exclusively", async () => {
  const { base, fs } = await provider();
  await base.symlink("source", "/source-link");
  const result = await command("cp", ["-P", "/source-link", "/new-link"], fs);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(await base.readlink("/new-link"), "source");
  assert.equal(await base.readlink("/source-link"), "source");
  await unchanged(base);
});

test("mv: entry budget rejects before content acquisition or publication", async () => {
  const base = createMemoryFileSystem();
  await base.mkdir("/source");
  let reads = 0, writes = 0;
  const fs = view(base, {
    rename: async () => { throw new FsError("EXDEV"); },
    readdir: async () => Array.from({ length: 100_001 }, (_, index) => ({ name: `entry-${index}`, type: "file" as const })),
    readFile: async () => { reads++; return payload; },
    copyFile: async () => { writes++; },
    mkdir: async () => { writes++; },
    rm: async () => { writes++; },
    rmdir: async () => { writes++; },
  });
  const result = await command("mv", ["/source", "/target"], fs);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /EFBIG.*entry limit/u);
  assert.equal(reads, 0);
  assert.equal(writes, 0);
  assert.equal((await base.lstat("/source")).type, "directory");
});

for (const linkAtSource of [false, true]) test(`mv: unknown symlink entry identity cannot use followed authority; source=${linkAtSource}`, async () => {
  const { base, fs, events } = await provider();
  await base.symlink(linkAtSource ? "source" : "target", "/soft");
  let comparisons = 0;
  const result = await command("mv", linkAtSource ? ["/soft", "/target"] : ["/source", "/soft"], view(fs, {
    compareEntry: async () => { comparisons++; return "distinct"; },
  }));
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /ENOTSUP.*authoritative distinctness/u);
  assert.equal(comparisons, 0);
  assert.deepEqual(effects(events), []);
  assert.equal(await base.readlink("/soft"), linkAtSource ? "source" : "target");
  await unchanged(base);
});

test("cp -P: raced missing symlink destination is not overwritten", async () => {
  const { base, fs } = await provider();
  await base.symlink("source", "/soft");
  const result = await command("cp", ["-P", "/soft", "/new"], view(fs, { symlink: async (target, path, controls) => {
    await base.writeFile(path, previous);
    await base.symlink(target, path, controls);
  } }));
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /EEXIST/u);
  assert.deepEqual(await bytes(base, "/new"), previous);
  assert.equal(await base.readlink("/soft"), "source");
  await unchanged(base);
});

for (const scoped of [false, true]) test(`mv -n: alias remains an intentional successful skip; scoped=${scoped}`, async () => {
  const { base, fs, events } = await provider({ scoped, alias: true });
  const result = await command("mv", ["-n", "/source", "/target"], fs);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(events, []);
  assert.deepEqual(await bytes(base, "/source"), payload);
  assert.deepEqual(await bytes(base, "/target"), payload);
});
