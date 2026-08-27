import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem, createMountFileSystem, FsError, Shell, standardCommands, WebDavFileSystem } from "virtual-bash";
import type { FileSystem, FsOptions } from "virtual-bash";
import { applicationWebDav } from "./example.js";
import { withBackingDav } from "./provider.js";

const payload = new Uint8Array([0, 255, 128, 13, 10, 65]);
const previous = new Uint8Array([79, 76, 68]);
test("consumer resolves the built public package, not TypeScript source", () => {
  assert.ok(import.meta.resolve("virtual-bash").endsWith("/dist/index.js"));
});

async function seeded() {
  const backing = createMemoryFileSystem();
  await backing.writeFile("/source", payload);
  await backing.writeFile("/target", previous);
  return backing;
}
function bound(baseUrl: string, backing: FileSystem) {
  const remote: WebDavFileSystem = applicationWebDav(baseUrl, globalThis.fetch, async (filesystem, path, options) => {
    options.signal?.throwIfAborted();
    return filesystem === remote || filesystem === backing ? { filesystem: backing, path } : undefined;
  });
  return remote;
}

for (const command of ["cp", "mv"]) {
  for (const direction of ["to-remote", "from-remote"]) {
    test(`built public consumer: existing-target ${command} ${direction} through actual serialized HTTP`, async () => {
      const backing = await seeded();
      await withBackingDav(backing, async (baseUrl, requests) => {
        const remote = bound(baseUrl, backing);
        const mounted = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/local": backing, "/remote": remote } });
        const shell = new Shell({ fs: mounted }).use(standardCommands());
        const paths = direction === "to-remote" ? "/local/source /remote/target" : "/remote/source /local/target";
        const result = await shell.exec(`${command} ${paths}`);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stdout, "");
        assert.equal(result.stderr, "");
        assert.deepEqual(await backing.readFile("/target"), payload);
        if (command === "cp") assert.deepEqual(await backing.readFile("/source"), payload);
        else await assert.rejects(backing.stat("/source"), error => error instanceof FsError && error.code === "ENOENT");
        assert.deepEqual((await backing.readdir("/")).map(entry => entry.name), command === "cp" ? ["source", "target"] : ["target"]);
        assert.ok(requests.includes(direction === "to-remote" ? "PUT" : "GET"));
        assert.equal(requests.includes("DELETE"), command === "mv" && direction === "from-remote");
      });
    });
  }
}

for (const command of ["cp", "mv"]) {
  test(`built public consumer: ${command} overlapping backing alias preserves bytes`, async () => {
    const backing = await seeded();
    await withBackingDav(backing, async (baseUrl, requests) => {
      const remote = bound(baseUrl, backing);
      const mounted = createMountFileSystem({ root: backing, mounts: { "/remote": remote } });
      assert.equal(await remote.compareEntry("/source", backing, "/source"), "same");
      const result = await new Shell({ fs: mounted }).use(standardCommands()).exec(`${command} /remote/source /source`);
      assert.equal(result.exitCode, 1);
      assert.notEqual(result.stderr, "");
      assert.deepEqual(await backing.readFile("/source"), payload);
      assert.deepEqual(await backing.readFile("/target"), previous);
      assert.ok(requests.every(method => method === "PROPFIND"));
    });
  });

  test(`built public consumer: absent authority refuses existing-target ${command}`, async () => {
    const backing = await seeded();
    await withBackingDav(backing, async (baseUrl, requests) => {
      const remote = new WebDavFileSystem({ baseUrl, fetch: globalThis.fetch, overwritePolicy: "etag" });
      assert.equal(await remote.compareEntry("/source", backing, "/target"), "unknown");
      const mounted = createMountFileSystem({ root: backing, mounts: { "/remote": remote } });
      await assert.rejects(mounted.copyFile("/remote/source", "/target"), error => error instanceof FsError && error.code === "ENOTSUP");
      const result = await new Shell({ fs: mounted }).use(standardCommands()).exec(`${command} /remote/source /target`);
      assert.equal(result.exitCode, 1);
      assert.notEqual(result.stderr, "");
      assert.deepEqual(await backing.readFile("/source"), payload);
      assert.deepEqual(await backing.readFile("/target"), previous);
      assert.ok(requests.every(method => method === "PROPFIND"));
    });
  });
}

for (const abort of [false, true]) {
  test(`built public constructor callback propagates ${abort ? "abort" : "EACCES"} before content`, async () => {
    const backing = await seeded();
    await withBackingDav(backing, async (baseUrl, requests) => {
      const controller = new AbortController();
      const reason = new FsError("ENOENT");
      let calls = 0;
      const remote = new WebDavFileSystem({ baseUrl, fetch: globalThis.fetch, compareEntry: async function() {
        assert.equal(this, remote);
        calls++;
        if (abort) { controller.abort(reason); return "distinct"; }
        throw new FsError("EACCES");
      } });
      const mounted = createMountFileSystem({ root: backing, mounts: { "/remote": remote } });
      await assert.rejects(mounted.copyFile("/remote/source", "/target", { signal: controller.signal }),
        error => abort ? error === reason : error instanceof FsError && error.code === "EACCES");
      assert.equal(calls, 1);
      assert.ok(requests.every(method => method === "PROPFIND"));
      assert.deepEqual(await backing.readFile("/source"), payload);
      assert.deepEqual(await backing.readFile("/target"), previous);
    });
  });
}

test("built public constructor distinct cannot override serialized protocol alias proof", async () => {
  const backing = await seeded();
  await withBackingDav(backing, async (baseUrl, requests) => {
    let calls = 0;
    const remote = new WebDavFileSystem({ baseUrl, fetch: globalThis.fetch, compareEntry: async () => { calls++; return "distinct"; } });
    await assert.rejects(remote.compareEntry("/source", remote, "/source"), error => error instanceof FsError && error.code === "EIO");
    assert.equal(calls, 1);
    assert.ok(requests.every(method => method === "PROPFIND"));
    assert.deepEqual(await backing.readFile("/source"), payload);
  });
});

test("built public complete backing identities retain precedence without callback invocation", async () => {
  const backing = await seeded();
  await withBackingDav(backing, async (baseUrl, requests) => {
    class ScopedGateway extends WebDavFileSystem {
      override stat(path: string, options?: FsOptions) { return backing.stat(path, options); }
      override lstat(path: string, options?: FsOptions) { return backing.lstat(path, options); }
    }
    let calls = 0;
    const remote = new ScopedGateway({ baseUrl, fetch: globalThis.fetch, compareEntry: async () => { calls++; return "distinct"; } });
    assert.equal(await remote.compareEntry("/source", backing, "/source"), "same");
    assert.equal(calls, 0);
    assert.deepEqual(requests, []);
    assert.deepEqual(await backing.readFile("/source"), payload);
  });
});
