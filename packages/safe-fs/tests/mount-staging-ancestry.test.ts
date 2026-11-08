import assert from "node:assert/strict";
import { test } from "vitest";
import { createMemoryFileSystem } from "../src/fs/memory/index.js";
import { createMountFileSystem } from "../src/fs/mount/index.js";
import { createReadOnlyFileSystem } from "../src/fs/readonly/index.js";
import { scopeFileSystem } from "../src/fs/scoped.js";
import { compareIdentity, FsError, type FileSystem } from "../src/contracts/index.js";

for (const nested of [false, true]) {
  for (const race of ["none", "ancestor", "symlink", "abort", "guard", ...(nested ? ["outer"] as const : [])] as const) {
    test(`mixed skills mounts preserve staging publication: nested=${nested}, race=${race}`, async () => {
      const root = createMemoryFileSystem();
      if (nested) await root.mkdir("/skills");
      const writable = nested ? createMemoryFileSystem() : root;
      await writable.mkdir("/work");
      await writable.writeFile("/work/target", new Uint8Array([1]));
      const skills = createMemoryFileSystem();
      await skills.writeFile("/SKILL.md", new Uint8Array([7]));
      const controller = new AbortController();
      const stopped = new Error("execution ended");
      let publications = 0;
      const backing = new Proxy(writable, { get(target, key) {
        if (key === "publishStagedFile") return async (...args: Parameters<NonNullable<FileSystem["publishStagedFile"]>>) => {
          publications++;
          // Interleave after the mount adapter has prepared its guards, at the
          // backing publication boundary rather than before ancestry capture.
          if (race === "ancestor" || race === "symlink") {
            await writable.rename("/work", "/old");
            if (race === "symlink") await writable.symlink("/old", "/work");
            else await writable.mkdir("/work");
          }
          if (race === "outer") { await root.rename("/skills", "/old-skills"); await root.mkdir("/skills"); }
          if (race === "abort") controller.abort(stopped);
          return writable.publishStagedFile(...args);
        };
        const value: unknown = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      } });
      const mounted = createMountFileSystem({ root: nested ? root : backing, mounts: {
        "/skills/.system": createReadOnlyFileSystem(skills),
        ...(nested ? { "/skills/user": backing } : {}),
      } });
      const fs = scopeFileSystem(mounted, () => {}, controller.signal);
      const prefix = nested ? "/skills/user" : "";
      const path = `${prefix}/work/target`;
      assert.equal((await fs.capabilitiesFor!(path, { stagingAncestry: true })).atomicStagingAncestry, true);
      assert.equal((await fs.capabilitiesFor!("/skills/.system/SKILL.md", { stagingAncestry: true })).atomicStagingAncestry, false);
      await assert.rejects(fs.writeFile("/skills/.system/SKILL.md", new Uint8Array([8])), { code: "EROFS" });
      const descriptor = await fs.open!(path, { access: "read" });
      const before = await descriptor.stat();
      assert.equal(compareIdentity(before, await writable.lstat("/work/target")), "same");
      const resolution = await fs.prepareStagingResolution!(path);
      assert.deepEqual(resolution.ancestors.map(entry => entry.path), nested
        ? ["/", "/skills", "/skills/user", "/skills/user/work"] : ["/", "/work"]);
      const parent = await fs.lstat(`${prefix}/work`);
      const staging = await fs.createStagedFile!(`${prefix}/work/.stage`, "file", {
        type: "file", data: new Uint8Array([9]),
      }, { parent, retainCleanup: true });
      try {
        const publication = fs.publishStagedFile!(staging, path, {
          parent, destination: before, ancestors: resolution.ancestors,
          commitGuard: () => { if (race === "guard") throw stopped; return resolution.validate(); },
        });
        if (race === "none") {
          await publication;
          assert.deepEqual(await writable.readFile("/work/target"), new Uint8Array([9]));
          assert.equal(compareIdentity(await fs.lstat(path), staging.file.stat), "same");
          assert.equal(compareIdentity(await descriptor.stat(), before), "same");
          const bytes = new Uint8Array(1);
          assert.equal(await descriptor.read(bytes, 0), 1);
          assert.deepEqual(bytes, new Uint8Array([1]));
        } else {
          await assert.rejects(publication, race === "ancestor" || race === "symlink" || race === "outer"
            ? { code: "EAGAIN" } : error => error instanceof FsError && error.cause === stopped);
          const old = race === "ancestor" || race === "symlink" ? "/old" : "/work";
          assert.deepEqual(await writable.readFile(`${old}/target`), new Uint8Array([1]));
          if (race === "ancestor") await assert.rejects(writable.lstat("/work/target"), { code: "ENOENT" });
        }
        assert.equal(publications, 1);
      } finally {
        await staging.cleanup!.remove();
        await descriptor.close();
      }
      const directory = race === "ancestor" || race === "symlink" ? "/old" : "/work";
      assert.deepEqual((await writable.readdir(directory)).map(entry => entry.name), ["target"]);
      assert.deepEqual(await skills.readFile("/SKILL.md"), new Uint8Array([7]));
    });
  }
}

test("mount extraction confinement retains roots and rejects writes through other mounts", async () => {
  const root = createMemoryFileSystem();
  await root.mkdir("/work");
  await root.mkdir("/outside");
  await root.writeFile("/outside/file", new Uint8Array([1]));
  const child = createMemoryFileSystem();
  const mounted = createMountFileSystem({ root, mounts: { "/work/child": child } });
  const fs = await mounted.confineExtraction(["/work"]);
  await fs.writeFile("/work/allowed", new Uint8Array([2]));
  await assert.rejects(fs.writeFile("/outside/file", new Uint8Array([3])), { code: "EPERM" });
  await assert.rejects(fs.link!("/outside/file", "/work/link"), { code: "EPERM" });
  await assert.rejects(fs.chmod!("/outside/file", 0o777), { code: "EPERM" });
  await assert.rejects(fs.writeFile("/work/child/file", new Uint8Array([3])), { code: "EROFS" });
  await root.rename("/work", "/old");
  await root.mkdir("/work");
  await assert.rejects(fs.writeFile("/work/file", new Uint8Array([3])), { code: "EAGAIN" });
  assert.deepEqual(await child.readdir("/"), []);
  assert.deepEqual(await root.readFile("/outside/file"), new Uint8Array([1]));
  assert.deepEqual(await root.readdir("/work"), []);
});

test("mounts refuse staging ancestry through synthetic parents or unqualified backends", async () => {
  const root = createMemoryFileSystem();
  const child = createMemoryFileSystem();
  const synthetic = createMountFileSystem({ root, mounts: { "/missing/child": child } });
  assert.equal((await synthetic.capabilitiesFor("/missing/child/file", { create: true, stagingAncestry: true })).atomicStagingAncestry, false);
  const unqualified = new Proxy(root, { get(target, key) {
    if (key === "prepareDirectoryAncestry" || key === "confineExtraction") return undefined;
    const value: unknown = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const fs = createMountFileSystem({ root: unqualified });
  assert.equal((await fs.capabilitiesFor("/file", { create: true, stagingAncestry: true })).atomicStagingAncestry, false);
  await assert.rejects(fs.confineExtraction(["/"]), { code: "ENOTSUP" });
});
