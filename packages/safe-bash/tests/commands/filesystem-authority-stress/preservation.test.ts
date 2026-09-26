import assert from "node:assert/strict";
import test from "node:test";
import { FsError } from "../../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createMountFileSystem } from "../../../src/fs/mount/index.js";
import { bytes, command, effects, payload, previous, provider, unchanged, unscoped, view } from "./helpers.js";

for (const partial of [false, true]) test(`mv: failed publication preserves source; partial=${partial}`, async () => {
  const { base, fs, events } = await provider({ scoped: true, target: false });
  let publications = 0;
  const observed = view(fs, {
    compareEntry: async () => "distinct",
    writeStream: async (target, source, controls) => {
      publications++;
      assert.equal(controls?.flag, "wx");
      assert.deepEqual(await bytes(base, "/source"), payload);
      const chunks: Uint8Array[] = [];
      for await (const chunk of source) chunks.push(chunk.slice());
      const content = Buffer.concat(chunks);
      assert.deepEqual(content, payload);
      if (partial) await base.writeFile(target, content.subarray(0, 3), controls);
      throw new FsError("EIO", { message: "publication failed" });
    },
  });
  const result = await command("mv", ["/source", "/target"], observed);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /EIO.*publication failed/u);
  assert.equal(publications, 1);
  assert.deepEqual(effects(events), []);
  assert.deepEqual(await bytes(base, "/source"), payload);
  assert.deepEqual(await bytes(base, "/target"), partial ? payload.subarray(0, 3) : null);
});

for (const phase of ["copy", "metadata", "remove"] as const) test(`mv: cancellation at ${phase} never deletes source`, async () => {
  const { base, fs, events } = await provider({ scoped: true, target: false });
  const controller = new AbortController(), reason = new FsError("EACCES", { message: "caller canceled" });
  const reached: string[] = [];
  const observed = view(fs, {
    writeStream: async (target, source, controls) => {
      assert.equal(controls?.flag, "wx");
      await base.writeStream!(target, source, controls);
      reached.push("copy");
      if (phase === "copy") controller.abort(reason);
    },
    chmod: async (path, mode, controls) => {
      await base.chmod(path, mode, controls);
      reached.push("metadata");
      if (phase === "metadata") controller.abort(reason);
    },
    removeEntryConditional: async (_path, controls) => {
      assert.equal(phase, "remove");
      reached.push("remove");
      controller.abort(reason);
      controls?.signal?.throwIfAborted();
      throw new Error("unreachable mutation");
    },
  });
  await assert.rejects(command("mv", ["/source", "/target"], observed, controller.signal), error => error === reason);
  assert.deepEqual(reached, phase === "copy" ? ["copy"] : phase === "metadata" ? ["copy", "metadata"] : ["copy", "metadata", "remove"]);
  assert.deepEqual(effects(events), []);
  assert.deepEqual(await bytes(base, "/source"), payload);
  assert.deepEqual(await bytes(base, "/target"), payload);
});

test("mv: raced destination requires exclusive creation", async () => {
  const { base, fs, events } = await provider({ scoped: true, target: false });
  let publications = 0;
  const observed = view(fs, { writeStream: async (target, source, controls) => {
    publications++;
    assert.equal(controls?.flag, "wx");
    await base.writeFile(target, previous);
    await base.writeStream!(target, source, controls);
  } });
  const result = await command("mv", ["/source", "/target"], observed);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /EEXIST/u);
  assert.equal(publications, 1);
  assert.deepEqual(effects(events), []);
  await unchanged(base);
});

test("mv -n: cross-device refusal preserves source without publishing a destination", async () => {
  const { base, fs, events } = await provider({ target: false });
  const observed = view(fs, { writeStream: async (target, source, controls) => {
    events.push("unexpected copy");
    await base.writeFile(target, previous);
    await base.writeStream!(target, source, controls);
  } });
  const result = await command("mv", ["-n", "/source", "/target"], observed);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /EXDEV/u);
  assert.deepEqual(events, ["rename:EXDEV"]);
  assert.deepEqual(await bytes(base, "/source"), payload);
  assert.equal(await bytes(base, "/target"), null);
});

test("mv: all directory publications precede cleanup; a later copy failure keeps every source", async () => {
  const base = createMemoryFileSystem();
  await base.mkdir("/source");
  await base.writeFile("/source/first", payload);
  await base.writeFile("/source/second", previous);
  const removals: string[] = [];
  const publications: string[] = [];
  const fs = view(base, {
    rename: async () => { throw new FsError("EXDEV"); },
    writeStream: async (target, source, controls) => {
      publications.push(target);
      assert.equal(controls?.flag, "wx");
      assert.deepEqual(await bytes(base, "/source/first"), payload);
      assert.deepEqual(await bytes(base, "/source/second"), previous);
      if (target === "/target/second") throw new FsError("ENOSPC");
      await base.writeStream!(target, source, controls);
    },
    rm: async path => { removals.push(path); },
    rmdir: async path => { removals.push(path); },
    removeEntryConditional: async path => { removals.push(path); },
  });
  const result = await command("mv", ["/source", "/target"], fs);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /ENOSPC/u);
  assert.deepEqual(publications, ["/target/first", "/target/second"]);
  assert.deepEqual(removals, []);
  assert.deepEqual(await bytes(base, "/source/first"), payload);
  assert.deepEqual(await bytes(base, "/source/second"), previous);
  assert.deepEqual(await bytes(base, "/target/first"), payload);
  assert.equal(await bytes(base, "/target/second"), null);
});

test("mv: deep traversal metadata failure rejects before any publication or recursive cleanup", async () => {
  const base = createMemoryFileSystem();
  await base.mkdir("/source");
  let leaf = "/source";
  for (let depth = 0; depth < 130; depth++) { leaf += "/child"; await base.mkdir(leaf); }
  await base.writeFile(`${leaf}/data`, payload);
  const mutations: string[] = [];
  const fs = view(base, {
    rename: async () => { throw new FsError("EXDEV"); },
    lstat: async (path, options) => {
      if (path === leaf) throw new FsError("EACCES");
      return base.lstat(path, options);
    },
    mkdir: async path => { mutations.push(path); },
    rm: async path => { mutations.push(path); },
    rmdir: async path => { mutations.push(path); },
  });
  const result = await command("mv", ["/source", "/target"], fs);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /EACCES/u);
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

test("mv: missing listed entry rejects before content acquisition or publication", async () => {
  const base = createMemoryFileSystem();
  await base.mkdir("/source");
  let reads = 0, writes = 0;
  const fs = view(base, {
    rename: async () => { throw new FsError("EXDEV"); },
    readdir: async () => [{ name: "missing", type: "file" as const }],
    openReadFile: async (path, controls) => { reads++; return base.openReadFile!(path, controls); },
    readFile: async () => { reads++; return payload; },
    writeStream: async () => { writes++; },
    copyFile: async () => { writes++; },
    removeEntryConditional: async () => { writes++; },
    mkdir: async () => { writes++; },
    rm: async () => { writes++; },
    rmdir: async () => { writes++; },
  });
  const result = await command("mv", ["/source", "/target"], fs);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /ENOENT/u);
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
