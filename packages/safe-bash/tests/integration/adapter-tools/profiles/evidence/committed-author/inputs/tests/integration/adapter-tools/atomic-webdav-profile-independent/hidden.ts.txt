import assert from "node:assert/strict";
import test from "node:test";
import {
  agentCommands, FsError, MemoryFileSystem, MountFileSystem, OverlayFileSystem,
  ReadOnlyFileSystem, Shell, WebDavFileSystem, type FileSystem,
} from "virtual-bash";
import type { WebDavAtomicEmptyDirectoryBinding, WebDavAtomicEmptyDirectoryRequest } from "virtual-bash/fs/webdav";
import { MockDav } from "../../../fs/webdav/mock.js";
import { atomicMockBinding } from "../atomic-webdav-profile/atomic-mock.js";

const namespace = "https://independent.invalid/dav/";
const payload = Uint8Array.of(0, 1, 128, 255, 13, 10);
type Change = (binding: WebDavAtomicEmptyDirectoryBinding, mock: MockDav) => WebDavAtomicEmptyDirectoryBinding;

function create(configured = true, change?: Change) {
  const mock = new MockDav();
  const binding = atomicMockBinding(mock, namespace);
  const selected = change?.(binding, mock) ?? binding;
  const requests: WebDavAtomicEmptyDirectoryRequest[] = [];
  const fs = new WebDavFileSystem({
    baseUrl: namespace, fetch: mock.createFetch(),
    ...(configured && process.env.INDEPENDENT_MUTATION !== "lost-capability" ? {
      atomicEmptyDirectory: { namespaceUrl: selected.namespaceUrl, removeEmptyDirectory: request => {
        requests.push(request);
        return selected.removeEmptyDirectory(request);
      } },
    } : {}),
  });
  return { mock, fs, binding, requests };
}

function snapshot(mock: MockDav) {
  return [...mock.files].sort(([left], [right]) => left.localeCompare(right))
    .map(([path, value]) => [path, value === null ? null : [...value]]);
}

function errno(code: string, path: string) {
  return (error: unknown) => {
    assert.ok(error instanceof FsError);
    assert.equal(error.code, code);
    assert.equal(error.path, path);
    return true;
  };
}

function noDelete(mock: MockDav) {
  assert.deepEqual(mock.requests.filter(request => request.init.method === "DELETE"), []);
}

async function exec(fs: FileSystem, source: string) {
  const shell = new Shell({ fs }).use(agentCommands());
  try { return await shell.exec(source); }
  finally { await shell.dispose(); }
}

function request(path: string): WebDavAtomicEmptyDirectoryRequest {
  return { operation: "atomic-empty-rmdir/v1", namespaceUrl: namespace, path };
}

test("hidden: direct helper mutates actual backing synchronously, exactly one entry", async () => {
  const { mock, binding } = create();
  mock.files.set("/target", null);
  mock.files.set("/target-sibling", payload);
  mock.files.set("/targeted", null);
  const methods = [mock.files.set, mock.files.delete, mock.files.keys];
  const pending = binding.removeEmptyDirectory(request("/target"));
  assert.equal(mock.files.has("/target"), false, "no await between empty check and deletion");
  assert.deepEqual(await pending, { ...request("/target"), outcome: "removed" });
  assert.deepEqual(snapshot(mock), [["/", null], ["/target-sibling", [...payload]], ["/targeted", null]]);
  assert.deepEqual([mock.files.set, mock.files.delete, mock.files.keys], methods);
  noDelete(mock);
});

for (const path of ["/target", "/space name", "/snow-雪", "/percent%2Fname", "/hash#name"]) {
  test(`hidden: configured public shell removes only exact encoded target ${path}`, async () => {
    const { mock, fs, requests } = create();
    await fs.mkdir(path);
    await fs.mkdir(`${path}-sibling`);
    await fs.writeFile(`${path}-sibling/keep`, payload);
    const before = snapshot(mock).filter(entry => entry[0] !== path);
    const result = await exec(fs, `rmdir '${path}'`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    assert.deepEqual(snapshot(mock), before);
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.path, path);
    assert.equal(requests[0]?.namespaceUrl, namespace);
    assert.equal(Object.isFrozen(requests[0]), true);
    noDelete(mock);
  });
}

for (const late of [false, true]) {
  for (const command of ["rmdir", "rm -d"]) {
    test(`hidden: ${command} ${late ? "late" : "existing"} deep child preserves exact namespace`, async () => {
      const { mock, fs, requests } = create(true, (binding, backing) => ({
        ...binding, removeEmptyDirectory: request => {
          if (late) {
            backing.files.set("/target/deep", null);
            backing.files.set("/target/deep/child", payload);
          }
          return binding.removeEmptyDirectory(request);
        },
      }));
      await fs.mkdir("/target");
      await fs.writeFile("/target-sibling", payload);
      if (!late) {
        await fs.mkdir("/target/deep");
        await fs.writeFile("/target/deep/child", payload);
      }
      const expected = new MockDav();
      for (const [path, value] of mock.files) expected.files.set(path, value);
      expected.files.set("/target/deep", null);
      expected.files.set("/target/deep/child", payload);
      const result = await exec(fs, `${command} /target`);
      assert.equal(result.exitCode, 1);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /ENOTEMPTY/);
      assert.equal(requests.length, 1);
      assert.deepEqual(snapshot(mock), snapshot(expected));
      assert.deepEqual(await fs.readFile("/target/deep/child"), payload);
      noDelete(mock);
    });
  }
}

test("hidden: direct namespace, operation, spelling and absent/file/root guards preserve bytes", async () => {
  const { mock, binding } = create();
  mock.files.set("/target", null);
  mock.files.set("/file", payload);
  const before = snapshot(mock);
  for (const namespaceUrl of ["https://other.invalid/dav/", `${namespace}nested/`, "https://independent.invalid/dav-sibling/"]) {
    await assert.rejects(binding.removeEmptyDirectory({ ...request("/target"), namespaceUrl }), errno("EINVAL", "/target"));
  }
  await assert.rejects(binding.removeEmptyDirectory({ ...request("/target"), operation: "DELETE" } as unknown as WebDavAtomicEmptyDirectoryRequest), errno("EINVAL", "/target"));
  for (const path of ["target", "/target/", "/target//x", "/target/../x", "/target/./x", "/target\\x", "/target\0"]) {
    await assert.rejects(binding.removeEmptyDirectory(request(path)), errno("EINVAL", path));
  }
  for (const [path, code] of [["/", "EBUSY"], ["/absent", "ENOENT"], ["/file", "ENOTDIR"]]) {
    await assert.rejects(binding.removeEmptyDirectory(request(path!)), errno(code!, path!));
  }
  assert.deepEqual(snapshot(mock), before);
  noDelete(mock);
});

test("hidden: stock refuses empty and nonempty without destructive fallback", async () => {
  const { mock, fs, requests } = create(false);
  await fs.mkdir("/target");
  const before = snapshot(mock);
  await assert.rejects(fs.rmdir("/target"), errno("ENOTSUP", "/target"));
  assert.deepEqual(snapshot(mock), before);
  await fs.writeFile("/target/child", payload);
  const nonempty = snapshot(mock);
  await assert.rejects(fs.rmdir("/target"), errno("ENOTEMPTY", "/target"));
  assert.deepEqual(snapshot(mock), nonempty);
  assert.equal(requests.length, 0);
  noDelete(mock);
});

test("hidden: raw helper refusals never turn into HTTP DELETE", async () => {
  const { mock, fs } = create(true, binding => ({ ...binding, removeEmptyDirectory: () => {
    throw new FsError("ENOTSUP", { path: "/target", syscall: "rmdir" });
  } }));
  await fs.mkdir("/target");
  const before = snapshot(mock);
  await assert.rejects(fs.rmdir("/target"), errno("ENOTSUP", "/target"));
  assert.deepEqual(snapshot(mock), before);
  noDelete(mock);
});

for (const field of ["operation", "namespaceUrl", "path", "outcome"] as const) {
  test(`hidden: corrupt ${field} receipt errors after effect without rollback or fallback`, async () => {
    const { mock, fs } = create(true, binding => ({ ...binding, removeEmptyDirectory: async request => ({
      ...await binding.removeEmptyDirectory(request), [field]: "wrong",
    }) }));
    await fs.mkdir("/target");
    await fs.writeFile("/sibling", payload);
    await assert.rejects(fs.rmdir("/target"), errno("EIO", "/target"));
    assert.equal(mock.files.has("/target"), false);
    assert.deepEqual(await fs.readFile("/sibling"), payload);
    noDelete(mock);
  });
}

test("hidden: canonical binding mismatch fails before callback and preserves storage", () => {
  const { mock, binding } = create();
  mock.files.set("/target", null);
  const before = snapshot(mock);
  assert.throws(() => new WebDavFileSystem({ baseUrl: namespace, fetch: mock.fetch,
    atomicEmptyDirectory: { ...binding, namespaceUrl: "https://independent.invalid/dav-sibling/" },
  }), { code: "EINVAL" });
  assert.deepEqual(snapshot(mock), before);
  noDelete(mock);
});

test("hidden: lock ancestors and descendants block; expired and prefix siblings do not", async () => {
  for (const locked of ["/", "/parent", "/parent/target", "/parent/target/descendant"]) {
    const { mock, binding } = create();
    mock.files.set("/parent", null);
    mock.files.set("/parent/target", null);
    mock.locks.set(locked, { token: "independent", expires: Date.now() + 60_000 });
    const before = snapshot(mock);
    await assert.rejects(binding.removeEmptyDirectory(request("/parent/target")), errno("EBUSY", "/parent/target"));
    assert.deepEqual(snapshot(mock), before);
    noDelete(mock);
  }
  const { mock, binding } = create();
  mock.files.set("/target", null);
  mock.locks.set("/target", { token: "expired", expires: 0 });
  mock.locks.set("/target-sibling", { token: "active", expires: Date.now() + 60_000 });
  await binding.removeEmptyDirectory(request("/target"));
  assert.equal(mock.files.has("/target"), false);
  assert.equal(mock.locks.size, 2);
});

test("hidden: errno-shaped preabort preserves exact reason and backing", async () => {
  const { mock, binding } = create();
  mock.files.set("/target", null);
  const reason = new FsError("ENOENT", { path: "/unrelated" });
  const before = snapshot(mock);
  await assert.rejects(binding.removeEmptyDirectory({ ...request("/target"), signal: AbortSignal.abort(reason) }), error => error === reason);
  assert.deepEqual(snapshot(mock), before);
});

for (const wrapper of ["mount", "readonly", "readonly-mount", "webdav-upper"] as const) {
  test(`hidden: actual ${wrapper} contract, not fabricated capabilities`, async () => {
    const { mock, fs, requests } = create();
    await fs.mkdir("/target");
    await fs.writeFile("/target-sibling", payload);
    const before = snapshot(mock);
    const local = new MemoryFileSystem();
    await local.mkdir("/remote-sibling");
    await local.writeFile("/remote-sibling/keep", payload);
    let wrapped: FileSystem;
    let path = "/target";
    if (wrapper === "mount") {
      wrapped = new MountFileSystem({ root: local, mounts: { "/remote": fs } });
      path = "/remote/target";
    } else if (wrapper === "readonly-mount") {
      wrapped = new MountFileSystem({ root: local, mounts: { "/remote": new ReadOnlyFileSystem(fs) } });
      path = "/remote/target";
    } else if (wrapper === "readonly") wrapped = new ReadOnlyFileSystem(fs);
    else wrapped = new OverlayFileSystem({ lower: local, upper: fs });
    assert.equal(fs.capabilities.atomicRename, false);
    assert.notEqual(wrapped.capabilities.snapshotRmdir, true);
    const result = await exec(wrapped, `rmdir ${path}`);
    assert.equal(result.stdout, "");
    if (wrapper === "mount") {
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(requests.length, 1);
      assert.equal(requests[0]?.path, "/target");
      assert.deepEqual(snapshot(mock), before.filter(entry => entry[0] !== "/target"));
    } else {
      assert.equal(result.exitCode, 1);
      assert.match(result.stderr, wrapper === "webdav-upper" ? /ENOTSUP/ : /EROFS/);
      if (wrapper === "webdav-upper") assert.equal(wrapped.capabilities.readOnly, true);
      assert.equal(requests.length, 0);
      assert.deepEqual(snapshot(mock), before);
    }
    assert.deepEqual(await local.readFile("/remote-sibling/keep"), payload);
    noDelete(mock);
  });
}

test("hidden: mount forwards late-child refusal and preserves sibling mount prefix", async () => {
  const { fs, mock, requests } = create(true, (binding, backing) => ({ ...binding, removeEmptyDirectory: request => {
    backing.files.set("/target/late", payload);
    return binding.removeEmptyDirectory(request);
  } }));
  await fs.mkdir("/target");
  const local = new MemoryFileSystem();
  await local.mkdir("/remote-sibling");
  await local.writeFile("/remote-sibling/keep", payload);
  const mount = new MountFileSystem({ root: local, mounts: { "/remote": fs } });
  const result = await exec(mount, "rm -d /remote/target");
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /ENOTEMPTY/);
  assert.equal(requests[0]?.path, "/target");
  assert.deepEqual(await mount.readFile("/remote/target/late"), payload);
  assert.deepEqual(await mount.readFile("/remote-sibling/keep"), payload);
  noDelete(mock);
});

test("hidden: overlay lower nonempty refusal cannot hide existing descendants", async () => {
  const { fs, mock, requests } = create();
  await fs.mkdir("/target");
  await fs.writeFile("/target/child", payload);
  const before = snapshot(mock);
  const overlay = new OverlayFileSystem({ lower: fs, upper: new MemoryFileSystem() });
  const result = await exec(overlay, "rmdir /target");
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /not empty|ENOTEMPTY/i);
  assert.deepEqual(await overlay.readFile("/target/child"), payload);
  assert.deepEqual(snapshot(mock), before);
  assert.equal(requests.length, 0);
  noDelete(mock);
});

test("hidden: independent clients of same backing never fabricate disjoint identities", async () => {
  const { fs, mock, binding } = create();
  await fs.writeFile("/same", payload);
  const peer = new WebDavFileSystem({ baseUrl: namespace, fetch: mock.createFetch(), atomicEmptyDirectory: binding });
  const left = await fs.stat("/same");
  const right = await peer.stat("/same");
  assert.equal(left.identityScope, undefined);
  assert.equal(right.identityScope, undefined);
  assert.equal(await fs.compareEntry("/same", peer, "/same"), "same");
  const before = snapshot(mock);
  const mount = new MountFileSystem({ root: new MemoryFileSystem(), mounts: { "/left": fs, "/right": peer } });
  const result = await exec(mount, "cp /left/same /right/same");
  assert.equal(result.exitCode, 1);
  assert.deepEqual(snapshot(mock), before);
  noDelete(mock);
});
