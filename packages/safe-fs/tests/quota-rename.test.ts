import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { test } from "vitest";
import { createMemoryFileSystem } from "../src/fs/memory/index.js";
import { FileSystemQuotaError, withFileSystemQuota } from "../src/fs/quota/index.js";

for (const kind of ["file", "directory", "noReplace"] as const) {
  test(`quota serializes concurrent ${kind} rename with a byte census`, async () => {
    const raw = createMemoryFileSystem();
    await raw.mkdir("/a");
    await raw.mkdir("/b");
    if (kind === "directory") await raw.mkdir("/a/secret");
    await raw.writeFile(kind === "directory" ? "/a/secret/file" : "/a/secret", new Uint8Array([65]));
    let reachedScan!: () => void;
    const scanning = new Promise<void>(resolve => { reachedScan = resolve; });
    let releaseScan!: () => void;
    const gate = new Promise<void>(resolve => { releaseScan = resolve; });
    const readdir = raw.readdir.bind(raw);
    raw.readdir = async (path, options) => {
      if (path === "/a") {
        reachedScan();
        await gate;
      }
      return readdir(path, options);
    };
    let capabilityChecks = 0;
    raw.capabilitiesFor = async () => {
      capabilityChecks++;
      return raw.capabilities;
    };
    const quota = withFileSystemQuota(raw, { maxBytes: 1 });
    const write = quota.writeFile("/new", new Uint8Array([66]));
    const rejectedWrite = assert.rejects(write, FileSystemQuotaError);
    await scanning;
    let renamed = false;
    const rename = quota.rename("/a/secret", "/b/secret", kind === "noReplace" ? { noReplace: true } : undefined)
      .then(() => { renamed = true; });
    try {
      await setImmediate();
      assert.equal(renamed, false, "rename must wait for the census to finish");
      assert.equal(capabilityChecks, 0, "rename capability checks must use the same queue");
    } finally {
      releaseScan();
      await Promise.allSettled([rejectedWrite, rename]);
    }
    await rejectedWrite;
    await rename;
    assert.equal(capabilityChecks, kind === "noReplace" ? 1 : 0);
    assert.equal((await raw.stat(kind === "directory" ? "/b/secret/file" : "/b/secret")).size, 1);
    await assert.rejects(raw.stat("/new"), { code: "ENOENT" });
    await assert.rejects(quota.writeFile("/new", new Uint8Array([66])), FileSystemQuotaError);
  });
}
