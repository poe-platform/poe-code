import assert from "node:assert/strict";
import type { FileSystemCapabilities } from "../../../../src/contracts/filesystem.js";
import type { MockS3Request, S3ObjectInput } from "../../../../src/fs/s3/index.js";

export interface ObjectSnapshot {
  readonly key: string;
  readonly body: Uint8Array;
  readonly metadata: Record<string, string> | undefined;
  readonly etag: string | undefined;
}

export function assertSnapshotProfile(capabilities: FileSystemCapabilities): void {
  assert.equal(capabilities.snapshotRmdir, true);
}

export function assertExactMarkerRemoval(
  before: readonly ObjectSnapshot[],
  after: readonly ObjectSnapshot[],
  mutations: readonly MockS3Request[],
  marker: S3ObjectInput,
): void {
  const markers = before.filter(entry => entry.key === marker.Key);
  assert.equal(markers.length, 1);
  assert.equal(markers[0]!.body.length, 0);
  assert.equal(before.some(entry => entry.key !== marker.Key && entry.key.startsWith(marker.Key)), false);
  assert.deepEqual(mutations, [{ operation: "deleteObject", input: marker }]);
  assert.deepEqual(after, before.filter(entry => entry.key !== marker.Key));
}
