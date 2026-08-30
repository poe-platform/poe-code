import assert from "node:assert/strict";
import test from "node:test";
import {
  agentCommands, FsError, MemoryFileSystem, MountFileSystem, OverlayFileSystem,
  ReadOnlyFileSystem, Shell, WebDavFileSystem, type FileSystem,
} from "virtual-bash";
import type { WebDavAtomicEmptyDirectoryBinding, WebDavAtomicEmptyDirectoryRequest } from "virtual-bash/fs/webdav";
import { MockDav } from "../../../fs/webdav/mock.js";
import { atomicMockBinding } from "./atomic-mock.js";

const namespaceUrl = "https://configured-mock.invalid/dav/";
const bytes = Uint8Array.of(0, 255, 128, 10);
type BindingFactory = (binding: WebDavAtomicEmptyDirectoryBinding, mock: MockDav) => WebDavAtomicEmptyDirectoryBinding;

function setup(configured = true, change?: BindingFactory) {
  const mock = new MockDav();
  const binding = atomicMockBinding(mock, namespaceUrl);
  const requests: WebDavAtomicEmptyDirectoryRequest[] = [];
  const selected = change ? change(binding, mock) : binding;
  const fs = new WebDavFileSystem({ baseUrl: namespaceUrl, fetch: mock.fetch, ...(configured ? {
    atomicEmptyDirectory: { namespaceUrl: selected.namespaceUrl, removeEmptyDirectory: async request => {
      requests.push(request);
      return selected.removeEmptyDirectory(request);
    } },
  } : {}) });
  return { fs, mock, binding, requests };
}

function error(code: string, path: string) {
  return (reason: unknown) => {
    assert.ok(reason instanceof FsError);
    assert.equal(reason.code, code);
    assert.equal(reason.path, path);
    return true;
  };
}

function noDelete(mock: MockDav) {
  assert.deepEqual(mock.requests.filter(request => request.init.method === "DELETE"), []);
}

async function command(fs: FileSystem, source: string) {
  const shell = new Shell({ fs }).use(agentCommands());
  try { return await shell.exec(source); }
  finally { await shell.dispose(); }
}

test("stock negative control: empty ENOTSUP, nonempty ENOTEMPTY, no child loss or DELETE", async () => {
  const { fs, mock, requests } = setup(false);
  await fs.mkdir("/empty");
  await assert.rejects(fs.rmdir("/empty"), error("ENOTSUP", "/empty"));
  for (const source of ["rmdir /empty", "rm -d /empty"]) {
    const result = await command(fs, source);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /ENOTSUP/);
  }
  await fs.writeFile("/empty/child", bytes);
  await assert.rejects(fs.rmdir("/empty"), error("ENOTEMPTY", "/empty"));
  assert.deepEqual(await fs.readFile("/empty/child"), bytes);
  assert.deepEqual(requests, []);
  noDelete(mock);
});

test("configured operation removes only its real backing entry and preserves siblings", async () => {
  const { fs, mock, requests } = setup();
  await fs.mkdir("/space % ü");
  await fs.writeFile("/sibling", bytes);
  await fs.rmdir("/space % ü/");
  assert.equal(mock.files.has("/space % ü"), false);
  await assert.rejects(fs.stat("/space % ü"), error("ENOENT", "/space % ü"));
  assert.deepEqual(await fs.readFile("/sibling"), bytes);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.path, "/space % ü");
  assert.equal(requests[0]?.namespaceUrl, namespaceUrl);
  assert.ok(requests[0]?.signal);
  noDelete(mock);
});

test("helper namespace, operation and path guards reject before mutation", async () => {
  const { fs, mock, binding } = setup();
  await fs.mkdir("/empty");
  for (const namespace of ["https://other.invalid/dav/", `${namespaceUrl}nested/`]) {
    await assert.rejects(binding.removeEmptyDirectory({ operation: "atomic-empty-rmdir/v1", namespaceUrl: namespace, path: "/empty" }), error("EINVAL", "/empty"));
  }
  for (const path of ["empty", "/empty/", "/../empty", "/empty//child", "/empty\0", "/empty\\child"]) {
    await assert.rejects(binding.removeEmptyDirectory({ operation: "atomic-empty-rmdir/v1", namespaceUrl, path }), error("EINVAL", path));
  }
  const invalidOperation = { operation: "recursive-delete", namespaceUrl, path: "/empty" } as unknown as WebDavAtomicEmptyDirectoryRequest;
  await assert.rejects(binding.removeEmptyDirectory(invalidOperation), error("EINVAL", "/empty"));
  for (const invalid of ["https://configured-mock.invalid/else/", `${namespaceUrl}?query=1`, "https://user:pass@configured-mock.invalid/dav/"]) {
    assert.throws(() => atomicMockBinding(mock, invalid), { code: "EINVAL" });
  }
  assert.equal(mock.files.get("/empty"), null);
  noDelete(mock);
});

test("adapter rejects mismatched binding namespace before host callback", () => {
  assert.throws(() => setup(true, binding => ({ ...binding, namespaceUrl: "https://other.invalid/dav/" })), { code: "EINVAL" });
});

for (const field of ["operation", "namespaceUrl", "path", "outcome"] as const) {
  test(`adapter receipt guard: wrong ${field}, EIO and no fallback DELETE`, async () => {
    const { fs, mock } = setup(true, binding => ({ ...binding, removeEmptyDirectory: async request => {
      const receipt = await binding.removeEmptyDirectory(request);
      return { ...receipt, [field]: "mismatch" };
    } }));
    await fs.mkdir("/empty");
    await fs.writeFile("/sibling", bytes);
    await assert.rejects(fs.rmdir("/empty"), error("EIO", "/empty"));
    assert.equal(mock.files.has("/empty"), false, "receipt rejection cannot undo completed host removal");
    assert.deepEqual(await fs.readFile("/sibling"), bytes);
    noDelete(mock);
  });
}

for (const late of [false, true]) {
  for (const source of ["rmdir /empty", "rm -d /empty"]) {
    test(`configured ${late ? "late" : "existing"} child survives ${source} without recursive DELETE`, async () => {
      const { fs, mock, requests } = setup(true, binding => ({ ...binding, removeEmptyDirectory: async request => {
        if (late) await fs.writeFile("/empty/child", bytes);
        return binding.removeEmptyDirectory(request);
      } }));
      await fs.mkdir("/empty");
      if (!late) await fs.writeFile("/empty/child", bytes);
      const result = await command(fs, source);
      assert.equal(result.exitCode, 1);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /ENOTEMPTY/);
      assert.equal(requests.length, 1);
      assert.deepEqual(await fs.readFile("/empty/child"), bytes);
      noDelete(mock);
    });
  }
}

test("helper respects active mock locks and pre-aborted cancellation", async () => {
  const { fs, mock, binding } = setup();
  await fs.mkdir("/empty");
  const lock = await mock.fetch(`${namespaceUrl}empty/`, { method: "LOCK", headers: { Timeout: "Second-60", Depth: "infinity" }, body: "<lockinfo/>" });
  assert.equal(lock.status, 200);
  await assert.rejects(fs.rmdir("/empty"), error("EBUSY", "/empty"));
  const reason = new Error("cancelled before backing mutation");
  await assert.rejects(binding.removeEmptyDirectory({ operation: "atomic-empty-rmdir/v1", namespaceUrl, path: "/empty", signal: AbortSignal.abort(reason) }), value => value === reason);
  assert.equal(mock.files.get("/empty"), null);
  noDelete(mock);
});

for (const configured of [false, true]) {
  for (const wrapper of ["readonly", "mount", "overlay"] as const) {
    test(`${wrapper}: actual ${configured ? "configured" : "stock"} capability propagation through agentCommands`, async () => {
      const { fs, mock, requests } = setup(configured);
      await fs.mkdir("/empty");
      let wrapped: FileSystem;
      let path = "/empty";
      if (wrapper === "readonly") wrapped = new ReadOnlyFileSystem(fs);
      else if (wrapper === "mount") {
        wrapped = new MountFileSystem({ root: new MemoryFileSystem(), mounts: { "/remote": fs } });
        path = "/remote/empty";
      } else wrapped = new OverlayFileSystem({ lower: new MemoryFileSystem(), upper: fs });
      assert.notEqual(wrapped.capabilities.snapshotRmdir, true, "atomic profile is not S3 snapshot-marker removal");
      const result = await command(wrapped, `rmdir ${path}`);
      if (wrapper === "overlay") {
        assert.equal(fs.capabilities.atomicRename, false);
        assert.equal(wrapped.capabilities.readOnly, true, "atomic rmdir does not supply the atomic rename required by overlay upper");
      }
      const succeeds = configured && wrapper === "mount";
      assert.equal(result.exitCode, succeeds ? 0 : 1, result.stderr);
      assert.equal(result.stdout, "");
      if (succeeds) {
        assert.equal(result.stderr, "");
        await assert.rejects(wrapped.stat(path), error("ENOENT", path));
        assert.equal(mock.files.has("/empty"), false);
        assert.equal(requests.length, 1);
        assert.equal(requests[0]?.path, "/empty");
      } else {
        assert.match(result.stderr, wrapper === "readonly" ? /EROFS/ : /ENOTSUP/);
        assert.equal((await wrapped.stat(path)).type, "directory");
        assert.equal(mock.files.get("/empty"), null);
        assert.equal(requests.length, 0);
      }
      noDelete(mock);
    });
  }
}

test("mount forwards configured removal and preserves a child created after adapter preflight", async () => {
  const { fs, mock, requests } = setup(true, binding => ({ ...binding, removeEmptyDirectory: async request => {
    await fs.writeFile("/empty/late", bytes);
    return binding.removeEmptyDirectory(request);
  } }));
  await fs.mkdir("/empty");
  const mount = new MountFileSystem({ root: new MemoryFileSystem(), mounts: { "/remote": fs } });
  await assert.rejects(mount.rmdir("/remote/empty"), error("ENOTEMPTY", "/remote/empty"));
  assert.equal(requests.length, 1);
  assert.deepEqual(await mount.readFile("/remote/empty/late"), bytes);
  assert.deepEqual(await fs.readFile("/empty/late"), bytes);
  noDelete(mock);
});

for (const configured of [false, true]) {
  test(`overlay with ${configured ? "configured" : "stock"} WebDAV lower whiteouts only its view without host removal`, async () => {
    const { fs, mock, requests } = setup(configured);
    await fs.mkdir("/empty");
    await fs.writeFile("/sibling", bytes);
    const upper = new MemoryFileSystem();
    const overlay = new OverlayFileSystem({ lower: fs, upper });
    assert.equal(overlay.capabilities.readOnly, false);
    const result = await command(overlay, "rmdir /empty");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    await assert.rejects(overlay.stat("/empty"), error("ENOENT", "/empty"));
    assert.equal((await fs.stat("/empty")).type, "directory");
    await fs.writeFile("/empty/later", bytes);
    assert.deepEqual(await fs.readFile("/empty/later"), bytes);
    await assert.rejects(overlay.stat("/empty/later"), error("ENOENT", "/empty"));
    assert.deepEqual(await overlay.readFile("/sibling"), bytes);
    assert.equal(requests.length, 0, "lower whiteout is not forwarded atomic removal");
    noDelete(mock);
  });
}
