import assert from "node:assert/strict";
import test from "node:test";
import { FsError } from "../../../src/contracts/errors.js";
import type { FileSystem, FsOptions } from "../../../src/contracts/filesystem.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createMountFileSystem } from "../../../src/fs/mount/index.js";
import { createS3Transport, MockS3Client, S3FileSystem } from "../../../src/fs/s3/index.js";

const payload = new Uint8Array([0, 255, 13, 10, 42]);
const previous = new Uint8Array([70, 0, 71, 128]);

function mounted(left: FileSystem, right: FileSystem) {
  return createMountFileSystem({ root: new MemoryFileSystem(), mounts: { "/left": left, "/right": right } });
}

async function preserved(source: FileSystem, target: FileSystem) {
  assert.deepEqual(await source.readFile("/source"), payload);
  assert.deepEqual(await target.readFile("/target"), previous);
  assert.deepEqual(await source.readdir("/"), [{ name: "source", type: "file" }]);
  assert.deepEqual(await target.readdir("/"), [{ name: "target", type: "file" }]);
}

for (const direction of ["source", "target"] as const) {
  for (const outcome of ["same", "distinct", "unknown", "error", "invalid", "cancel"] as const) {
    test(`late Memory ${direction} authority ${outcome} precedes content effects`, async () => {
      const memory = new MemoryFileSystem();
      memory.readFile = memory.readFile.bind(memory);
      const service = new MockS3Client({ buckets: ["bucket"] });
      const remote = new S3FileSystem({ bucket: "bucket", transport: createS3Transport(service, service.capabilities) });
      const source = direction === "source" ? memory : remote;
      const target = direction === "target" ? memory : remote;
      await source.writeFile("/source", payload);
      await target.writeFile("/target", previous);
      const filesystem = mounted(source, target);
      let queries = 0;
      let controller = new AbortController();
      const reason = new FsError("ENOENT", { message: "caller abort, not missing destination" });
      Reflect.set(memory, "compareEntry", async (path: string, peer: FileSystem, peerPath: string, options: FsOptions) => {
        queries++;
        assert.equal(path, direction === "source" ? "/source" : "/target");
        assert.equal(peer, remote);
        assert.equal(peerPath, direction === "source" ? "/target" : "/source");
        assert.equal(options.signal, controller.signal);
        if (outcome === "error") throw new FsError("EACCES");
        if (outcome === "cancel") { controller.abort(reason); return "distinct"; }
        return outcome === "invalid" ? "not-an-entry-relation" : outcome;
      });
      for (const action of ["compare", "copy"] as const) {
        queries = 0;
        controller = new AbortController();
        const start = service.requests.length;
        const operation = action === "compare"
          ? filesystem.compareEntry("/left/source", filesystem, "/right/target", { signal: controller.signal })
          : filesystem.copyFile("/left/source", "/right/target", { signal: controller.signal });
        if (outcome === "cancel") await assert.rejects(operation, error => error === reason);
        else if (outcome === "error" || outcome === "invalid" || action === "copy" && outcome !== "distinct") {
          const code = outcome === "error" ? "EACCES" : outcome === "invalid" ? "EIO" : outcome === "same" ? "EINVAL" : "ENOTSUP";
          await assert.rejects(operation, { code, path: "/left/source", dest: "/right/target" });
        } else assert.equal(await operation, action === "compare" ? outcome : undefined);
        assert.equal(queries, 1);
        if (action === "copy" && outcome === "distinct") {
          assert.deepEqual(await source.readFile("/source"), payload);
          assert.deepEqual(await target.readFile("/target"), payload);
        } else {
          assert.ok(service.requests.slice(start).every(request => ["headObject", "listObjectsV2"].includes(request.operation)));
          await preserved(source, target);
        }
      }
    });
  }
}

test("complete Memory tuples still win over late explicit callbacks", async () => {
  const left = new MemoryFileSystem();
  const right = new MemoryFileSystem();
  await left.writeFile("/source", payload);
  await left.link("/source", "/alias");
  await right.writeFile("/target", previous);
  left.compareEntry = right.compareEntry = async () => { assert.fail("known tuple queried late authority"); };
  const filesystem = mounted(left, right);
  assert.equal(await filesystem.compareEntry("/left/source", filesystem, "/left/alias"), "same");
  await assert.rejects(filesystem.copyFile("/left/source", "/left/alias"), { code: "EINVAL" });
  assert.equal(await filesystem.compareEntry("/left/source", filesystem, "/right/target"), "distinct");
  await filesystem.copyFile("/left/source", "/right/target");
  assert.deepEqual(await left.readFile("/source"), payload);
  assert.deepEqual(await right.readFile("/target"), payload);
});

for (const mode of ["conflict", "cancel", "preconstruction-peer"] as const) {
  test(`shared Memory authority ${mode} queries each operand at most once`, async () => {
    const calls: string[] = [];
    class ExternalMemory extends MemoryFileSystem {
      override async compareEntry() { calls.push("right"); return "unknown" as const; }
    }
    const left = new MemoryFileSystem();
    const right = mode === "preconstruction-peer" ? new ExternalMemory() : new MemoryFileSystem();
    await left.writeFile("/source", payload);
    await right.writeFile("/target", previous);
    const lstat = left.lstat.bind(left);
    left.lstat = async (path, options) => {
      const { identityScope: omitted, ...stat } = await lstat(path, options);
      void omitted;
      return stat;
    };
    let effects = 0;
    left.readStream = async function* () { effects++; yield payload; };
    right.writeStream = async () => { effects++; assert.fail("destination content opened"); };
    const controller = new AbortController();
    const reason = new FsError("ENOENT", { message: "cancel between operand callbacks" });
    left.compareEntry = async () => {
      calls.push("left");
      if (mode === "cancel") controller.abort(reason);
      return mode === "preconstruction-peer" ? "unknown" : "same";
    };
    if (mode !== "preconstruction-peer") right.compareEntry = async () => { calls.push("right"); return "distinct"; };
    const operation = mounted(left, right).copyFile("/left/source", "/right/target", { signal: controller.signal });
    if (mode === "cancel") await assert.rejects(operation, error => error === reason);
    else await assert.rejects(operation, { code: mode === "conflict" ? "EIO" : "ENOTSUP" });
    assert.deepEqual(calls, mode === "cancel" ? ["left"] : ["left", "right"]);
    assert.equal(effects, 0);
    await preserved(left, right);
  });
}

test("late forwarding of the base comparator remains bounded and unknown", async () => {
  const memory = new MemoryFileSystem();
  const service = new MockS3Client({ buckets: ["bucket"] });
  const remote = new S3FileSystem({ bucket: "bucket", transport: createS3Transport(service, service.capabilities) });
  await memory.writeFile("/source", payload);
  await remote.writeFile("/target", previous);
  let calls = 0;
  memory.compareEntry = async (path, peer, peerPath, options) => {
    calls++;
    return MemoryFileSystem.prototype.compareEntry.call(memory, path, peer, peerPath, options);
  };
  await assert.rejects(mounted(memory, remote).copyFile("/left/source", "/right/target"), { code: "ENOTSUP" });
  assert.equal(calls, 1);
  await preserved(memory, remote);
});
