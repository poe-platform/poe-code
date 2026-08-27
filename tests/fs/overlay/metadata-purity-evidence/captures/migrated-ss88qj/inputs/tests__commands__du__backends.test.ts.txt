import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { FsError, type FileSystem } from "../../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createRealFileSystem } from "../../../src/fs/real/index.js";
import { createReadOnlyFileSystem } from "../../../src/fs/readonly/index.js";
import { createMountFileSystem } from "../../../src/fs/mount/index.js";
import { createOverlayFileSystem } from "../../../src/fs/overlay/index.js";
import { S3FileSystem, MockS3Client } from "../../../src/fs/s3/index.js";
import { WebDavFileSystem } from "../../../src/fs/webdav/index.js";
import { MockDav } from "../../fs/webdav/mock.js";
import { seed, shellRun, trace, wrapped } from "./helpers.js";

for (const backend of ["memory", "real", "readonly", "mount", "overlay", "s3-mock", "dav-mock"] as const) {
  test(`actual Shell ${backend}: apparent positive flow and allocation qualification`, async context => {
    let fs: FileSystem = createMemoryFileSystem();
    let s3: MockS3Client | undefined, dav: MockDav | undefined;
    if (backend === "real") {
      const root = await mkdtemp(fileURLToPath(new URL(".native-real-", import.meta.url)));
      context.after(() => rm(root, { recursive: true, force: true }));
      fs = await createRealFileSystem({ root });
    }
    if (backend === "s3-mock") {
      s3 = new MockS3Client({ buckets: ["du"], pageSize: 1 });
      fs = new S3FileSystem({ transport: s3, bucket: "du", pageSize: 1 });
    }
    if (backend === "dav-mock") {
      dav = new MockDav(); fs = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: dav.fetch });
    }
    await seed(fs);
    if (backend === "readonly") fs = createReadOnlyFileSystem(fs);
    if (backend === "mount") fs = createMountFileSystem({ root: fs, mounts: { "/alias": fs } });
    if (backend === "overlay") fs = createOverlayFileSystem({ lower: fs, upper: createMemoryFileSystem() });
    const startS3 = s3?.requests.length ?? 0, startDav = dav?.requests.length ?? 0;
    const checked = trace(fs);
    const apparent = await shellRun(checked.fs, ["-bac", "tree"]);
    assert.equal(apparent.exitCode, 0, apparent.stderr);
    assert.equal(apparent.stdout, "3\ttree/a\n5\ttree/sub/b\n5\ttree/sub\n8\ttree\n8\ttotal\n");
    const allocated = await shellRun(checked.fs, ["-sc", "tree"]);
    if (backend === "real" && ["darwin", "linux"].includes(process.platform)) {
      assert.equal(allocated.exitCode, 0, allocated.stderr);
      assert.match(allocated.stdout, /^\d+\ttree\n\d+\ttotal\n$/u);
    } else {
      assert.equal(allocated.exitCode, 1); assert.equal(allocated.stdout, "");
      assert.match(allocated.stderr, /allocated bytes unknown/u);
    }
    assert.ok(checked.calls.every(call => call.method === "lstat" || call.method === "readdir"));
    assert.ok(checked.calls.every(call => call.signal instanceof AbortSignal));
    if (s3) assert.ok(s3.requests.slice(startS3).every(request => ["headObject", "listObjectsV2"].includes(request.operation)));
    if (dav) assert.ok(dav.requests.slice(startDav).every(request => request.init.method === "PROPFIND"));
  });
}

test("real allocation survives readonly/mount/overlay selected-entry wrappers", async context => {
  const root = await mkdtemp(fileURLToPath(new URL(".native-wrapper-", import.meta.url)));
  context.after(() => rm(root, { recursive: true, force: true }));
  const real = await createRealFileSystem({ root }); await seed(real);
  const expected = await shellRun(real, ["-sB1", "tree"]);
  for (const fs of [createReadOnlyFileSystem(real), createMountFileSystem({ root: real }), createOverlayFileSystem({ lower: real, upper: createMemoryFileSystem() })]) {
    const checked = trace(fs); const result = await shellRun(checked.fs, ["-sB1", "tree"]);
    assert.equal(result.exitCode, expected.exitCode); assert.equal(result.stdout, expected.stdout);
    assert.ok(checked.calls.every(call => ["lstat", "readdir"].includes(call.method)));
  }
});

test("different mount namespaces sharing directory identity are never pruned", async () => {
  const shared = createMemoryFileSystem(); await shared.mkdir("/dir");
  const extra = createMemoryFileSystem(); await extra.writeFile("/new", new Uint8Array(7));
  const view = createMountFileSystem({ root: shared, mounts: { "/dir/injected": extra } });
  const fs = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/first": shared, "/second": view } });
  const result = await shellRun(fs, ["-bsc", "/first/dir", "/second/dir"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "0\t/first/dir\n7\t/second/dir\n7\ttotal\n");
});

test("explicit Overlay cleanup retries pending garbage deletion after metadata-only DU", async () => {
  const upper = createMemoryFileSystem(); let denyCleanup = true; const mutations: string[] = [];
  const observedUpper = wrapped(upper, { async rm(path, options) {
    mutations.push(path);
    if (denyCleanup) throw new FsError("EACCES");
    return upper.rm(path, options);
  } });
  const overlay = createOverlayFileSystem({ upper: observedUpper, lower: createMemoryFileSystem() });
  await overlay.mkdir("/tree");
  const before = await upper.readdir("/");
  assert.ok(before.some(entry => entry.name.startsWith(".virtual-bash-overlay-")));
  mutations.length = 0; denyCleanup = false;
  const checked = trace(overlay); const result = await shellRun(checked.fs, ["-bs", "tree"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(checked.calls.map(call => call.method), ["lstat", "readdir"]);
  assert.deepEqual(mutations, []);
  assert.deepEqual(await upper.readdir("/"), before);
  await overlay.cleanup();
  assert.ok(mutations.length > 0, "explicit cleanup must retry pending garbage deletion");
  assert.ok(!(await upper.readdir("/")).some(entry => entry.name.startsWith(".virtual-bash-overlay-")));
});
