import assert from "node:assert/strict";
import { test } from "node:test";
import type { FileSystemCapabilities } from "../../../../src/contracts/filesystem.js";
import { S3FileSystem } from "../../../../src/fs/s3/index.js";
import type { MockS3Request } from "../../../../src/fs/s3/index.js";
import { createS3HttpTransport } from "../../../../src/fs/s3/http/index.js";
import { assertExactMarkerRemoval, assertSnapshotProfile } from "./assertions.js";
import type { ObjectSnapshot } from "./assertions.js";

const marker = { Bucket: "safe-workflows", Key: "work/scratch/nested/" };

function observation() {
  const before: ObjectSnapshot[] = [
    { key: "sentinel", body: new Uint8Array([255, 3]), metadata: { purpose: "preserve" }, etag: "sentinel" },
    { key: "work/", body: new Uint8Array(), metadata: { mode: "493" }, etag: "work" },
    { key: "work/scratch/", body: new Uint8Array(), metadata: { mode: "493" }, etag: "scratch" },
    { key: marker.Key, body: new Uint8Array(), metadata: { mode: "493" }, etag: "nested" },
  ];
  const after = structuredClone(before.filter(entry => entry.key !== marker.Key));
  const mutations: MockS3Request[] = [{ operation: "deleteObject", input: { ...marker } }];
  return { before, after, mutations };
}

test("fixture guard accepts only the disclosed exact-marker observation", () => {
  const { before, after, mutations } = observation();
  assertSnapshotProfile({ snapshotRmdir: true, atomicRename: false });
  assertExactMarkerRemoval(before, after, mutations, marker);
});

test("snapshot profile does not enable unverified HTTP conditions or issue requests", () => {
  let requests = 0;
  const transport = createS3HttpTransport({
    endpoint: "https://example.test", region: "us-east-1",
    credentials: { accessKeyId: "fixture", secretAccessKey: "fixture" },
    request() { requests++; throw new Error("network is forbidden in this construction-only control"); },
  });
  const fs = new S3FileSystem({ transport, bucket: "safe-workflows" });
  assertSnapshotProfile(fs.capabilities);
  assert.equal(fs.capabilities.atomicRename, false);
  assert.equal(transport.capabilities?.conditionalPut, false);
  assert.equal(transport.capabilities?.conditionalCopy, false);
  assert.equal(transport.capabilities?.conditionalDelete, false);
  assert.equal(requests, 0);
});

for (const capabilities of [{}, { snapshotRmdir: false }] satisfies FileSystemCapabilities[]) {
  test(`fixture guard rejects ${capabilities.snapshotRmdir === false ? "false" : "omitted"} snapshot profile`, () => {
    assert.throws(() => assertSnapshotProfile(capabilities), { code: "ERR_ASSERTION" });
  });
}

const tampers: { name: string; change(value: ReturnType<typeof observation>): void }[] = [
  { name: "missing DELETE", change(value) { value.mutations.length = 0; } },
  { name: "wrong marker key", change(value) { value.mutations[0] = { operation: "deleteObject", input: { ...marker, Key: "work/" } }; } },
  { name: "wrong bucket", change(value) { value.mutations[0] = { operation: "deleteObject", input: { ...marker, Bucket: "other" } }; } },
  { name: "child DELETE even with restored bytes", change(value) { value.mutations.push({ operation: "deleteObject", input: { ...marker, Key: `${marker.Key}child` } }); } },
  { name: "compensating marker PUT", change(value) { value.mutations.push({ operation: "putObject", input: { ...marker, Body: new Uint8Array() } }); } },
  { name: "marker still present", change(value) { value.after.push(structuredClone(value.before[3]!)); } },
  { name: "parent removed", change(value) { value.after.splice(1, 1); } },
  { name: "remaining bytes changed", change(value) { value.after[0]!.body[0] = 0; } },
  { name: "remaining metadata changed", change(value) { value.after[1]!.metadata!.mode = "511"; } },
  { name: "remaining ETag changed", change(value) { value.after[0] = { ...value.after[0]!, etag: "changed" }; } },
  { name: "unobserved marker", change(value) { value.before.pop(); } },
  { name: "nonempty marker body", change(value) { value.before[3] = { ...value.before[3]!, body: new Uint8Array([1]) }; } },
  { name: "observed descendant even when preserved", change(value) {
    const child = { key: `${marker.Key}child`, body: new Uint8Array([7]), metadata: {}, etag: "child" };
    value.before.push(child);
    value.after.push(structuredClone(child));
  } },
];

for (const tamper of tampers) {
  test(`fixture guard rejects ${tamper.name}`, () => {
    const value = observation();
    tamper.change(value);
    assert.throws(() => assertExactMarkerRemoval(value.before, value.after, value.mutations, marker), { code: "ERR_ASSERTION" });
  });
}
