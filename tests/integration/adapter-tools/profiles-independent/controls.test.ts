import assert from "node:assert/strict";
import test from "node:test";
import { agentCommands, MemoryFileSystem, MountFileSystem, OverlayFileSystem, ReadOnlyFileSystem, Shell, type FileSystem } from "../../../../src/index.js";
import { atomicMockBinding } from "../atomic-webdav-profile/atomic-mock.js";
import { snapshotTree, withFixture, type FixtureProfileOptions } from "../fixtures.js";
import { withRmdirFixture } from "../profiles/rmdir-fixtures.js";

const bytes = Uint8Array.of(255, 0, 128, 13, 10, 42);
const configured: FixtureProfileOptions = { webdavAtomicBinding: atomicMockBinding };

async function execute(fs: FileSystem, command: string) {
  const shell = new Shell({ fs }).use(agentCommands());
  try { return await shell.exec(command); }
  finally { await shell.dispose(); }
}

test("new verifier: configured selector does not contaminate subsequent stock defaults", async () => {
  await withRmdirFixture("webdav", async ({ fs, exec, dav }) => {
    assert.ok(dav);
    assert.equal(fs.capabilities.atomicRename, false);
    assert.notEqual(fs.capabilities.snapshotRmdir, true);
    assert.equal((await exec("mkdir selected && rmdir selected")).exitCode, 0);
    assert.equal(dav.requests.filter(request => request.init.method === "DELETE").length, 0);
  });
  for (const profile of [undefined, {}]) {
    await withFixture("webdav", async ({ fs, exec, dav }) => {
      assert.ok(dav);
      await fs.mkdir("/work/stock");
      const before = await snapshotTree(fs, "/");
      await assert.rejects(fs.rmdir!("/work/stock"), { code: "ENOTSUP", path: "/work/stock" });
      for (const command of ["rmdir", "rm -d"]) {
        const result = await exec(`${command} stock`);
        assert.equal(result.exitCode, 1);
        assert.match(result.stderr, /ENOTSUP/);
        assert.deepEqual(await snapshotTree(fs, "/"), before);
      }
      assert.equal(dav.requests.filter(request => request.init.method === "DELETE").length, 0);
    }, undefined, profile);
  }
});

for (const command of ["rmdir", "rm -d"]) {
  test(`new verifier: loopback fixture ${command} refuses binding-time late descendant`, async () => {
    let calls = 0;
    await withFixture("webdav", async ({ fs, exec, dav }) => {
      assert.ok(dav);
      await fs.mkdir("/work/target");
      await fs.writeFile("/work/target-sibling", bytes);
      const result = await exec(`${command} target`);
      assert.equal(result.exitCode, 1);
      assert.match(result.stderr, /ENOTEMPTY/);
      assert.equal(calls, 1);
      assert.equal(dav.files.get("/work/target"), null);
      assert.deepEqual(await fs.readFile("/work/target/deeper/late"), bytes);
      assert.deepEqual(await fs.readFile("/work/target-sibling"), bytes);
      assert.equal(dav.requests.filter(request => request.init.method === "DELETE").length, 0);
    }, undefined, { webdavAtomicBinding: (dav, namespace) => {
      const binding = atomicMockBinding(dav, namespace);
      return { ...binding, removeEmptyDirectory: request => {
        calls++;
        dav.files.set(`${request.path}/deeper/late`, bytes);
        return binding.removeEmptyDirectory(request);
      } };
    } });
  });
}

for (const locked of ["/work", "/work/target", "/work/target/descendant"]) {
  test(`new verifier: fixture active lock ${locked} preserves namespace`, async () => {
    await withFixture("webdav", async ({ fs, exec, dav }) => {
      assert.ok(dav);
      await fs.mkdir("/work/target");
      dav.locks.set(locked, { token: "new-independent", expires: Date.now() + 60_000 });
      const before = await snapshotTree(fs, "/");
      const result = await exec("rmdir target");
      assert.equal(result.exitCode, 1);
      assert.match(result.stderr, /EBUSY/);
      assert.deepEqual(await snapshotTree(fs, "/"), before);
      assert.equal(dav.requests.filter(request => request.init.method === "DELETE").length, 0);
    }, undefined, configured);
  });
}

test("new verifier: fixture mismatched receipt reports completed effect without recursive retry", async () => {
  let calls = 0;
  await withFixture("webdav", async ({ fs, exec, dav }) => {
    assert.ok(dav);
    await fs.mkdir("/work/target");
    await fs.writeFile("/work/target-sibling", bytes);
    const result = await exec("rm -d target");
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /EIO/);
    assert.equal(calls, 1);
    assert.equal(dav.files.has("/work/target"), false);
    assert.deepEqual(await fs.readFile("/work/target-sibling"), bytes);
    assert.equal(dav.requests.filter(request => request.init.method === "DELETE").length, 0);
  }, undefined, { webdavAtomicBinding: (dav, namespace) => {
    const binding = atomicMockBinding(dav, namespace);
    return { ...binding, removeEmptyDirectory: async request => {
      calls++;
      return { ...await binding.removeEmptyDirectory(request), namespaceUrl: `${namespace}sibling/` };
    } };
  } });
});

test("new verifier: fixture factory rejects mismatched namespace before workload", async () => {
  let entered = false;
  let called = false;
  await assert.rejects(withFixture("webdav", async () => { entered = true; }, undefined, {
    webdavAtomicBinding: (dav, namespace) => {
      called = true;
      return { ...atomicMockBinding(dav, namespace), namespaceUrl: `${namespace}sibling/` };
    },
  }), { code: "EINVAL" });
  assert.equal(called, true);
  assert.equal(entered, false);
});

for (const wrapper of ["readonly-mount", "webdav-upper", "webdav-lower"] as const) {
  test(`new verifier: configured fixture ${wrapper} never hides nonempty descendants`, async () => {
    await withFixture("webdav", async ({ fs, dav }) => {
      assert.ok(dav);
      await fs.mkdir("/work/target");
      await fs.writeFile("/work/target/child", bytes);
      const before = await snapshotTree(fs, "/");
      const local = new MemoryFileSystem();
      const wrapped = wrapper === "readonly-mount"
        ? new MountFileSystem({ root: local, mounts: { "/remote": new ReadOnlyFileSystem(fs) } })
        : new OverlayFileSystem(wrapper === "webdav-upper" ? { upper: fs, lower: local } : { upper: local, lower: fs });
      const path = wrapper === "readonly-mount" ? "/remote/work/target" : "/work/target";
      assert.notEqual(wrapped.capabilities.snapshotRmdir, true);
      for (const command of ["rmdir", "rm -d"]) {
        const result = await execute(wrapped, `${command} ${path}`);
        assert.equal(result.exitCode, 1);
        assert.match(result.stderr, wrapper === "readonly-mount" ? /EROFS/ : wrapper === "webdav-upper" ? /ENOTSUP/ : /not empty|ENOTEMPTY/i);
        assert.deepEqual(await wrapped.readFile(`${path}/child`), bytes);
        assert.deepEqual(await snapshotTree(fs, "/"), before);
      }
      assert.equal(dav.requests.filter(request => request.init.method === "DELETE").length, 0);
    }, undefined, configured);
  });
}

for (const mounted of [false, true]) {
  test(`new verifier: S3 snapshot marker late-child disclosure mounted=${mounted}`, async () => {
    await withRmdirFixture("s3", async ({ fs, s3 }) => {
      assert.ok(s3);
      await fs.mkdir("/work/target");
      const marker = { Bucket: "adapter-tools", Key: "isolated/work/target/" };
      const originalDelete = s3.deleteObject.bind(s3);
      let calls = 0;
      s3.deleteObject = async (input, options) => {
        assert.deepEqual(input, marker);
        assert.ok(options?.abortSignal);
        calls++;
        await s3.putObject({ ...marker, Key: `${marker.Key}late`, Body: bytes }, options);
        return originalDelete(input, options);
      };
      try {
        const wrapped = mounted ? new MountFileSystem({ root: new MemoryFileSystem(), mounts: { "/remote": fs } }) : fs;
        assert.equal(wrapped.capabilities.snapshotRmdir, true);
        const path = mounted ? "/remote/work/target" : "/work/target";
        const result = await execute(wrapped, `rm -d ${path}`);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(calls, 1);
        assert.deepEqual(await wrapped.readFile(`${path}/late`), bytes);
        assert.equal((await wrapped.stat(path)).type, "directory");
        await assert.rejects(s3.headObject(marker), { code: "NoSuchKey" });
      } finally { s3.deleteObject = originalDelete; }
    });
  });
}

test("new verifier: readonly S3 mount refuses deletion without erasing or elevating snapshot authority", async () => {
  await withFixture("s3", async ({ fs, s3 }) => {
    assert.ok(s3);
    await fs.mkdir("/work/target");
    const readonly = new ReadOnlyFileSystem(fs);
    const mount = new MountFileSystem({ root: new MemoryFileSystem(), mounts: { "/remote": readonly } });
    assert.equal(fs.capabilities.snapshotRmdir, true);
    assert.notEqual(readonly.capabilities.snapshotRmdir, true);
    assert.notEqual(mount.capabilities.snapshotRmdir, true);
    const before = await snapshotTree(fs, "/");
    const start = s3.requests.length;
    for (const command of ["rmdir", "rm -d"]) {
      const result = await execute(mount, `${command} /remote/work/target`);
      assert.equal(result.exitCode, 1);
      assert.match(result.stderr, /read.only|EROFS/i);
      assert.deepEqual(await snapshotTree(fs, "/"), before);
    }
    assert.equal(s3.requests.slice(start).filter(request => request.operation === "deleteObject").length, 0);
  });
});
