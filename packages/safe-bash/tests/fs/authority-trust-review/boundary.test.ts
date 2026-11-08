import assert from "node:assert/strict";
import test from "node:test";
import { FsError } from "../../../src/contracts/errors.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createMountFileSystem } from "../../../src/fs/mount/index.js";
import { compareEntries } from "../public-comparison.js";
import { MockS3Client, S3FileSystem, S3ServiceError, createS3Transport } from "../../../src/fs/s3/index.js";

const bytes = (value: string) => new TextEncoder().encode(value);
const text = async (filesystem: ReturnType<typeof createMemoryFileSystem>, path: string) => new TextDecoder().decode(await filesystem.readFile(path, { maxBytes: 1024 }));

test("B1 OUT OF CONTRACT remote metadata with Memory write routing retains concrete source damage", { timeout: 5000 }, async () => {
  const memory = createMemoryFileSystem();
  await memory.writeFile("/source", bytes("source sentinel"));
  await memory.writeFile("/keep", bytes("keep"));
  const store = new MockS3Client({ buckets: ["bucket"] });
  await store.putObject({ Bucket: "bucket", Key: "source", Body: bytes("remote sentinel") });
  const effects: string[] = [];
  const transport = createS3Transport(store, { ...store.capabilities, streamingWrite: false });
  transport.getObject = async () => { effects.push("GET"); return { Body: await memory.readFile("/source", { maxBytes: 1024 }) }; };
  transport.putObject = async () => {
    effects.push("PUT");
    await memory.writeFile("/source", bytes("damaged"));
    throw new S3ServiceError("InternalError", 500);
  };
  const remote = new S3FileSystem({ bucket: "bucket", transport });
  const relation = await compareEntries(memory, "/source", remote, "/source");
  const mount = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/local": memory, "/remote": remote } });
  let status: string | undefined;
  try { await mount.copyFile("/local/source", "/remote/source"); } catch (error) { assert.ok(error instanceof FsError); status = error.code; }
  const remoteBytes = await store.getObject({ Bucket: "bucket", Key: "source" });
  const observed = { relation, status, effects, source: await text(memory, "/source"), keep: await text(memory, "/keep"),
    remote: new TextDecoder().decode(remoteBytes.Body as Uint8Array), names: (await memory.readdir("/")).map(entry => entry.name) };
  console.log(JSON.stringify({ boundary: "OUT OF CONTRACT; no acceptance credit", observed }));
  assert.equal(relation, "distinct");
  assert.equal(status, "EIO");
  assert.deepEqual(effects, ["PUT"]);
  assert.equal(observed.source, "damaged");
  assert.equal(observed.keep, "keep");
  assert.equal(observed.remote, "remote sentinel");
  assert.deepEqual(observed.names.sort(), ["keep", "source"]);
});

test("B2 OPEN serialized SDK metadata lacks cross-backend authority despite faithful content routing", { timeout: 5000 }, async () => {
  const store = new MockS3Client({ buckets: ["bucket"] });
  const transport = createS3Transport(store, store.capabilities);
  transport.headObject = async (input, options) => {
    const response = await store.headObject(input, options);
    return { ...response, ...(response.Metadata ? { Metadata: { ...response.Metadata } } : {}) };
  };
  const remote = new S3FileSystem({ bucket: "bucket", transport });
  const memory = createMemoryFileSystem();
  await memory.writeFile("/source", bytes("source sentinel"));
  await remote.writeFile("/target", bytes("old target"));
  const relation = await compareEntries(memory, "/source", remote, "/target");
  const mount = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/local": memory, "/remote": remote } });
  await assert.rejects(mount.copyFile("/local/source", "/remote/target"), { code: "ENOTSUP" });
  const target = new TextDecoder().decode(await remote.readFile("/target", { maxBytes: 1024 }));
  assert.equal(relation, "unknown");
  assert.equal(await text(memory, "/source"), "source sentinel");
  assert.equal(target, "old target");
  assert.deepEqual((await remote.readdir("/")).map(entry => entry.name), ["target"]);
  assert.deepEqual((await memory.readdir("/")).map(entry => entry.name), ["source"]);
  console.log(JSON.stringify({ boundary: "OPEN real-provider gap; no positive-workflow credit", relation, status: "ENOTSUP", source: "source sentinel", target }));
});
